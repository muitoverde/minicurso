# Especificação Técnica: MVSky Monitor (SIAAGRO 2026)

Documento arquitetural e de engenharia de software para o desenvolvimento da aplicação web de monitoramento orbital biofísico de lavouras **MVSky Monitor**, desenvolvida para produtores e técnicos de Rondônia no evento SIAAGRO 2026 (IFRO Ariquemes), integrada à plataforma de geoprocessamento da Muito Verde.

---

## 1. Visão Geral e Princípios Arquiteturais

- **Nome do Projeto:** MVSky Monitor
- **Metodologia:** Spec-Driven Development (SDD)
- **Padrão Arquitetural:** Model-View-Controller (MVC) desacoplado
- **Módulos Frontend:** ES6 Modules nativos com instâncias Singleton exportadas em minúsculo
- **Estilização:** Vanilla CSS moderno (Design Tokens, Dark Mode HUD, Glassmorphism, tipografia Quicksand)
- **Mapeamento:** Leaflet 1.9+ com camada base de satélite ESRI World Imagery
- **Backend:** Node.js (porta 3333) atuando como Proxy Seguro e orquestrador de sessão

---

## 2. Estrutura de Diretórios e Arquivos

```text
minicurso/
├── .env.local
├── .gitignore
├── package.json
├── server.js
├── spec.md
└── public/
    ├── index.html
    ├── css/
    │   └── style.css
    └── js/
        ├── app.js
        ├── controllers/
        │   └── appController.js
        ├── models/
        │   ├── spectralModel.js
        │   └── stateModel.js
        └── views/
            ├── authModalView.js
            ├── heatmapView.js
            ├── mapView.js
            └── statsView.js
```

---

## 3. Especificação do HUD e Componentes de Interface

### 3.1 Header Superior (`#app-header`)
- **Container e Posicionamento:** Flutuante no topo (`top: 16px; left: 16px; right: 16px; height: 56px`), com efeito de vidro (`backdrop-filter: blur(12px); background: rgba(15, 23, 42, 0.85)`).
- **Identidade e HUD Agrícola:**
  ```html
  <div class="brand-container">
    <div class="brand-title">Monitoramento de Lavouras</div>
  </div>
  ```
  *Regra Mandatória:* Proibição absoluta de links âncora mortos (`<a href="#">` ou `http://localhost:3333/#`).
- **Barra de Busca (`#map-search-bar`):**
  - Input para localização geográfica por município (via API Nominatim OpenStreetMap Brasil com debounce de 350ms) ou por coordenadas diretas em formato decimal (`lat, lng`).
  - Executa transição de câmera suave (`map.flyTo([lat, lng], zoom)`).
- **Chips da Carteira Muito Verde (Visíveis apenas com sessão autenticada):**
  - **Selo do Plano:** Badge verde esmeralda indicando `BÁSICO` ou `CNPJ` (`#chip-tier`).
  - **Quota de Monitoramento:** Badge indicando consumo de área, ex: `42.5 / 100 ha` (`#chip-quota`).
  - **Saldo Carteira Muito Verde:** Saldo em moeda Muito Verde, ex: `1.250 MV` (`#chip-wallet`).
  - **Créditos Operacionais:** Saldo de créditos retornado pela API Muito Verde em tempo real, ex: `creditsBalance CR` (`#chip-credits`).
- **Controle de Usuário (`#btn-auth-trigger`):**
  - Estado Guest: Botão "Entrar" com destaque esmeralda.
  - Estado Autenticado: Avatar circular com iniciais do produtor/empresa e menu rápido para Logout.

---

### 3.2 Gaveta Lateral de Monitoramento (`#monitoring-panel`)
- **Dimensões e Posicionamento:** Flutuante à direita (`top: 84px; right: 16px; bottom: 24px; width: 380px; z-index: 1000`), fundo escuro translúcido com borda suave (`border: 1px solid rgba(255, 255, 255, 0.08)`).
- **Navegação por Abas:**
  - Aba 1: `Campos` (`#tab-fields`)
  - Aba 2: `Análise de Índices` (`#tab-indices`)

#### Aba 1: Campos (Hierarquia Fazenda -> Talhão)
1. **Estado Não Logado (Guest):**
   - Mensagem explicativa orientando autenticação para visualização de propriedades.
   - Botão de abertura do modal de login e botão "+ Cadastrar Talhão".
2. **Estado Logado:**
   - **Nível 1 — Propriedade (Fazenda):**
     - Dropdown seletor de fazenda ativa (`#property-selector`).
     - Botão "+ Nova Fazenda" (`#btn-new-property`), abrindo o modal `#property-modal` (Campos: Nome, Município/RO, CAR com botão de colagem de snippet).
     - Estado vazio quando não houver propriedades cadastradas.
   - **Nível 2 — Talhões da Fazenda Selecionada:**
     - Listagem de cartões de talhões da propriedade ativa (`#fields-list`), contendo Nome, Cultura e Área calculada em hectares.
     - Botão "+ Cadastrar Talhão" (`#btn-new-field`), abrindo o modal `#field-modal` (Campos: Nome, Cultura, demarcação interativa ou colagem de GeoJSON Polygon).
     - Estado vazio quando a fazenda ativa não possuir talhões cadastrados.
   - *Regra Mandatória:* Zero mock no backend ou auto-geração de fazendas demonstrativas. A seleção de um talhão voa a câmera para a cerca (`map.flyToBounds(bounds)`), ativa automaticamente a Aba 2 e dispara o geoprocessamento.

#### Aba 2: Análise de Índices
1. **Seletor de Índice Espectral:** Pílulas interativas exclusivas da aba (`#index-selector`):
   - `NDVI` (Índice de Vegetação por Diferença Normalizada)
   - `NDRE` (Red-Edge - Clorofila e Nitrogênio)
   - `MSAVI` (Vegetação Ajustada ao Solo)
   - `NDMI` (Índice de Umidade da Vegetação)
   - `RECI` (Índice de Clorofila Red-Edge)
2. **Seletor de Passagem Orbital / Data:** Dropdown de datas (`#date-selector`) populado com o histórico da constelação Sentinel-2 (`historicalSeries`) contendo a data e percentual de nuvens (ex: `2026-10-14 (7.4% nuvens)`).
3. **Destaque Biofísico:**
   - Valor numérico médio destacado em fonte 36px bold (`#stat-main-value`).
   - Badge de vigor agronômico com cores semânticas Muito Verde (`#stat-main-badge`): `EXCELENTE`, `BOM`, `MODERADO`, `CRITICO`.
4. **Tabelas Estatísticas Oficiais:**
   - **Tabela 1: Métricas Gerais (`#table-general-metrics`):** Média, Mínimo, Máximo, Desvio Padrão, Área Total (ha) e Resolução Espacial (10m - Sentinel-2).
   - **Tabela 2: Distribuição por Faixas de Vigor (`#table-vigor-distribution`):** Amostra de cor da paleta Muito Verde, Faixa de Valor, Classificação Agronômica, % da Área e Hectares.
5. **Ações:**
   - Botão de alternância de visualização (`#btn-toggle-view`): Alterna entre "Ver Zonas de Manejo" e "Ver Mapa Contínuo".
   - Botão "Baixar Relatório CSV" (`#btn-export-csv`): Exporta os dados tabulares estruturados conforme padrão ABNT/RFC 4180.

---

### 3.3 Legenda Contínua de Cores (`#color-legend`)
- Posicionada no canto inferior direito da tela (`bottom: 24px; right: 412px; z-index: 900`).
- Gradiente visual das 20 cores da paleta oficial Muito Verde com marcações de valor mínimo, médio e máximo do índice selecionado.

---

## 4. Camadas Biofísicas e Algoritmo de Renderização (`heatmapView.js`)

A renderização espectral opera em dois modos mutuamente exclusivos:

### 4.1 Modo Padrão: Raster Contínuo com Interpolação Bicúbica por GPU (512x512)
1. **Canvas Offscreen (24x24):**
   - Dimensão original correspondente à matriz espectral retornada pela Muito Verde (`computation.matrix`).
   - Mapeamento de cada célula de reflectância para a escala cromática de 20 classes Muito Verde.
   - *Regra Estrita de Transparência:* Pixels nulos, indefinidos ou fora do polígono (`null`, `undefined`, `isNaN(val)`) recebem canal alpha = 0:
     ```javascript
     if (val === null || val === undefined || isNaN(val)) {
       imgData.data[pixelIdx + 3] = 0;
       continue;
     }
     ```
2. **Canvas de Exibição (512x512) com Máscara Poligonal:**
   - Recorte milimétrico da cerca do talhão via `ctx2.clip()` utilizando as coordenadas projetadas do GeoJSON.
   - Habilitação da interpolação suave de alta fidelidade:
     ```javascript
     ctx2.imageSmoothingEnabled = true;
     ctx2.imageSmoothingQuality = 'high';
     ctx2.drawImage(canvas1, 0, 0, 512, 512);
     ```
3. **Projeção Geoespacial Leaflet:**
   - Adicionada ao mapa via `L.imageOverlay(canvas2.toDataURL(), bounds, { opacity: 0.88 })`.
   - Adiciona contorno perimetral do talhão em verde esmeralda (`#10b981`, `weight: 2`, `fill: false`).
   - *Proibição Absoluta:* É expressamente proibido renderizar grades brancas ou divisórias internas entre células raster.

### 4.2 Modo Alternativo: Zonas de Manejo Vetoriais
- Utiliza a coleção de polígonos agrupados retornada pela API (`computation.vectorLayer`).
- Renderizado via `L.geoJSON` com contornos de células desativados (`weight: 0`, `stroke: false`) e preenchimento colorido conforme a propriedade `fill`.
- Contorno externo do talhão preservado em `#10b981`.
- Tooltips interativos nos polígonos exibindo classe, índice médio e área em hectares.

---

## 5. Contrato de Comunicação e Endpoints da API

### 5.1 Endpoints do Backend Local (Node.js Proxy)

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/api/auth/session` | Retorna o estado atual da sessão (`authenticated`, `user`, `wallet`). |
| `POST` | `/api/auth/login` | Recebe `{ apiKey }` ou consome a chave de ambiente, validando na Muito Verde. |
| `POST` | `/api/auth/logout` | Encerra a sessão ativa local. |
| `GET` | `/api/properties` | Lista as propriedades cadastradas na sessão. |
| `POST` | `/api/properties` | Cadastra nova propriedade na sessão. |
| `GET` | `/api/fields` | Lista os talhões vinculados a uma propriedade (`?propertyId=...`). |
| `POST` | `/api/fields` | Cadastra novo talhão na sessão com validação do GeoJSON. |
| `POST` | `/api/geo/spectral-index` | Proxy seguro para o cálculo de índices na Muito Verde. |

---

### 5.2 Contrato com a API da Muito Verde (Sentinel-2 Geo)

- **URL Oficial:** `https://muitoverde.com.br/api/b2b/v1/geo/spectral-index`
- **Validação de Schema:** Validação estrita Zod (`.strict()`).
- **Campos Aceitos:**
  - `fieldId` (string, opcional)
  - `polygon` (GeoJSON Polygon, obrigatório se não houver fieldId)
  - `indexType` (enum: `NDVI`, `NDRE`, `MSAVI`, `NDMI`, `RECI`)
  - `startDate` (string, formato `YYYY-MM-DD`)
  - `endDate` (string, formato `YYYY-MM-DD`)
  - `maxCloudCover` (number, padrão: 20)
  - `idempotencyKey` (string, opcional como parâmetro ou header `Idempotency-Key`)
- *Regra Mandatória:* Proibição de envio do parâmetro `date`. Filtros temporais utilizam estritamente `startDate` e `endDate`.
- **Headers Requeridos:**
  - `X-API-Key`: Chave do produtor (`mv_live_...` ou `mv_test_...`)
  - `Idempotency-Key`: Identificador único da execução (8 a 120 caracteres)
  - `Content-Type`: `application/json`

---

## 6. Contrato de Interfaces dos Módulos ES6 (Padrão Singleton)

Todos os módulos frontend exportam instâncias únicas (Singletons) em minúsculo:

### 6.1 `public/js/views/mapView.js`
```javascript
export const mapView = new MapView();
```
- `init(containerId = 'map')`: Inicializa o mapa Leaflet com tiles ESRI World Imagery, centralizado em Rondônia (`[-9.945, -62.961]`, zoom 13).
- `getMap()`: Retorna a instância ativa do Leaflet `L.Map`.
- `zoomToField(polygon)`: Ajusta a extensão visual com animação suave para a cerca do talhão (`map.fitBounds` ou `map.flyToBounds`).
- `renderFieldBoundary(polygon)`: Desenha o polígono da cerca com linha esmeralda `#10b981`.

### 6.2 `public/js/views/authModalView.js`
```javascript
export const authModalView = new AuthModalView();
```
- `init(onLoginCallback)`: Vincula os eventos do formulário, input de chave e botão de Acesso Rápido.
- `open()`: Exibe o modal de autenticação.
- `close()`: Fecha o modal.
- `updateHeader(session)`: Atualiza o botão de usuário, avatar e exibe/oculta os chips da Carteira Muito Verde.

### 6.3 `public/js/views/heatmapView.js`
```javascript
export const heatmapView = new HeatmapView();
```
- `render(map, polygon, computation, mode = 'raster')`: Processa a matriz e projeta a camada (raster bicúbico ou zonas vetoriais). Trata pixels nulos com `alpha = 0`.
- `clear(map)`: Remove com segurança as camadas raster e vetoriais ativas do mapa.
- `toggleMode(map, polygon, computation)`: Alterna entre os modos de exibição e atualiza o texto do botão.

### 6.4 `public/js/views/statsView.js`
```javascript
export const statsView = new StatsView();
```
- `renderPropertySelector(properties, activePropertyId, onSelect, onNew)`: Renderiza o seletor de fazendas e listeners.
- `renderFieldCards(fields, activeFieldId, onSelect, onNew)`: Renderiza os cartões dos talhões da fazenda ativa.
- `update(field, computation, indexName)`: Atualiza o destaque biofísico, métricas gerais e tabela de distribuição.
- `reset()`: Limpa os dados analíticos exibidos na Aba 2.
- `exportCSV(indexName)`: Gera e dispara o download do arquivo CSV formatado.
- `updateDateSelector(historicalSeries, activeDate, onDateChange)`: Popula o seletor de datas Sentinel-2.

### 6.5 `public/js/models/stateModel.js`
```javascript
export const stateModel = new StateModel();
```
- `getState()`: Retorna cópia imutável do estado da aplicação (sessão, fazenda ativa, talhão ativo, índice selecionado, data selecionada, camada biofísica ativa).
- `setState(updates)`: Atualiza o estado central e notifica os observadores registrados.

### 6.6 `public/js/models/spectralModel.js`
```javascript
export const spectralModel = new SpectralModel();
```
- `getSession()`: Consulta `/api/auth/session`.
- `login(apiKey)`: Envia requisição para `/api/auth/login`.
- `logout()`: Envia requisição para `/api/auth/logout`.
- `getProperties()`: Consulta `/api/properties`.
- `createProperty(data)`: Envia dados para `/api/properties`.
- `getFields(propertyId)`: Consulta `/api/fields?propertyId=...`.
- `createField(data)`: Envia dados para `/api/fields`.
- `analyze({ fieldId, polygon, indexType, startDate, endDate, maxCloudCover })`: Dispara a análise biofísica para o backend.

### 6.7 `public/js/controllers/appController.js`
```javascript
export const appController = new AppController();
```
- `init()`: Orquestra o ciclo de vida inicial, instancia os módulos, verifica sessão ativa e configura fluxos de eventos.

### 6.8 `public/js/app.js`
- Ponto de entrada que importa `appController` e inicializa no evento `DOMContentLoaded`:
```javascript
import { appController } from './controllers/appController.js';

document.addEventListener('DOMContentLoaded', () => {
  appController.init();
});
```

---

## 7. Snippets Oficiais de Teste (Sem Mock no Backend)

### 7.1 Snippet de Fazenda (Propriedade)
```json
{
  "name": "Campus Ariquemes IFRO",
  "municipality": "Ariquemes/RO",
  "car": "RO-1100023-F6A7B2C3D4E5F6A7B2C3D4E5F6A7B2C3"
}
```

### 7.2 Snippet de Talhão (Campo)
```json
{
  "name": "Cacau Clonal em SAF — IFRO Ariquemes",
  "crop": "Cacau SAF",
  "polygon": {
    "type": "Polygon",
    "coordinates": [
      [
        [-62.9642, -9.9442],
        [-62.9594, -9.9442],
        [-62.9594, -9.9482],
        [-62.9642, -9.9482],
        [-62.9642, -9.9442]
      ]
    ]
  }
}
```

---

## 8. Critérios de Aceite e Validação Técnica

1. **Conexão MCP:** Servidor da Muito Verde ativo e chave validada via `apps/me` e `geo/spectral-index`.
2. **Branding e HUD:** Tipografia Quicksand, ausência de links mortos (`#`), chips de carteira funcionais com dados em tempo real.
3. **Isolamento de Credenciais:** Frontend nunca manipula chave mestra diretamente; backend local gerencia a comunicação autenticada.
4. **Precisão Biofísica:** Matriz Sentinel-2 interpolada em 512x512 via GPU sem bordas celulares internas, com máscara estrita de recorte no perímetro do talhão.
5. **Zero Mock:** Ausência de dados estáticos injetados pelo backend; fluxo conduzido 100% pelos inputs do usuário ou colagem de snippets oficiais.
