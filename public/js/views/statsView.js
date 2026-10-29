class StatsView {
  constructor() {
    this.lastComputation = null;
    this.lastIndexName = 'NDVI';
    this.lastField = null;
    this.lastHistoricalSeries = [];
    this.activeHistoricalDate = null;
    this.onDateChangeCallback = null;
    this.camposViewMode = 'card'; // 'card' | 'list'
  }

  renderPropertySelector(properties = [], activePropertyId, onSelect, onNew) {
    const select = document.getElementById('property-select');
    const emptyState = document.getElementById('property-empty-state');
    const newBtn = document.getElementById('btn-new-property');
    const emptyNewBtn = document.getElementById('btn-empty-new-property');

    if (newBtn && onNew) newBtn.onclick = onNew;
    if (emptyNewBtn && onNew) emptyNewBtn.onclick = onNew;

    if (!select || !emptyState) return;

    if (!properties || properties.length === 0) {
      select.style.display = 'none';
      emptyState.style.display = 'block';
      select.innerHTML = '';
      return;
    }

    select.style.display = 'block';
    emptyState.style.display = 'none';
    select.innerHTML = properties.map(p => `
      <option value="${p.id}" ${p.id === activePropertyId ? 'selected' : ''}>
        ${p.name} (${p.municipality})
      </option>
    `).join('');

    select.onchange = (e) => {
      if (onSelect) onSelect(e.target.value);
    };
  }

  renderFieldCards(fields = [], activeFieldId, onSelect, onNew) {
    const container = document.getElementById('fields-container');
    const emptyState = document.getElementById('fields-empty-state');
    const subtitleEl = document.getElementById('campos-count-subtitle');
    const activeStatEl = document.getElementById('campos-stat-active');
    const areaStatEl = document.getElementById('campos-stat-area');

    if (!container || !emptyState) return;

    // Atualiza contadores do Mini Hero de Campos (1:1 Alvo Certo)
    const count = fields.length;
    const totalArea = fields.reduce((sum, f) => sum + Number(f.areaHectares || 0), 0);

    if (subtitleEl) subtitleEl.textContent = `${count} ${count === 1 ? 'área cadastrada' : 'áreas cadastradas'}`;
    if (activeStatEl) activeStatEl.textContent = `${count} ativos`;
    if (areaStatEl) areaStatEl.textContent = `${totalArea.toFixed(1)} ha`;

    if (!fields || fields.length === 0) {
      container.style.display = 'none';
      emptyState.style.display = 'block';
      container.innerHTML = '';
      const emptyBtn = document.getElementById('btn-empty-new-field');
      if (emptyBtn && onNew) {
        emptyBtn.onclick = () => onNew();
      }
      const emptyDrawBtn = document.getElementById('btn-empty-draw-field');
      if (emptyDrawBtn && onNew) {
        emptyDrawBtn.onclick = () => {
          const drawBtn = document.getElementById('btn-campos-draw');
          if (drawBtn) drawBtn.click();
          else onNew();
        };
      }
      return;
    }

    container.style.display = 'flex';
    emptyState.style.display = 'none';

    if (this.camposViewMode === 'list') {
      // Modo Lista (CamposTab 1:1)
      container.innerHTML = fields.map(f => {
        const isActive = f.id === activeFieldId;
        return `
          <div class="field-list-item ${isActive ? 'active' : ''}" data-id="${f.id}">
            <div>
              <div class="field-list-title">${f.name}</div>
              <span class="badge-crop" style="font-size:10px;">${f.crop}</span>
            </div>
            <div style="font-size:11px;font-weight:700;color:var(--color-emerald-light);">
              ${f.areaHectares ? f.areaHectares.toFixed(1) + ' ha' : 'Demarcado'}
            </div>
          </div>
        `;
      }).join('');
    } else {
      // Modo Card (CamposTab 1:1 com Mini SVG Preview)
      container.innerHTML = fields.map(f => {
        const isActive = f.id === activeFieldId;
        const svgMini = this._generateFieldMiniSvg(f.polygon);
        return `
          <div class="field-card ${isActive ? 'active' : ''}" data-id="${f.id}">
            <div class="field-card-preview">
              ${svgMini}
            </div>
            <div class="field-card-info">
              <div class="field-card-title">${f.name}</div>
              <div class="field-card-meta">
                <span class="badge-crop">${f.crop}</span>
                <span>${f.areaHectares ? f.areaHectares.toFixed(1) + ' ha' : 'Área demarcada'}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    container.querySelectorAll('.field-card, .field-list-item').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        const selected = fields.find(f => f.id === id);
        if (selected && onSelect) onSelect(selected);
      });
    });
  }

  toggleCamposViewMode(fields, activeFieldId, onSelect) {
    this.camposViewMode = this.camposViewMode === 'card' ? 'list' : 'card';
    this.renderFieldCards(fields, activeFieldId, onSelect);
    return this.camposViewMode;
  }

  _generateFieldMiniSvg(polygon) {
    if (!polygon) return '';
    let coords = [];
    if (polygon.type === 'Polygon' && Array.isArray(polygon.coordinates)) {
      coords = polygon.coordinates[0] || [];
    } else if (polygon.geometry?.type === 'Polygon') {
      coords = polygon.geometry.coordinates[0] || [];
    } else if (Array.isArray(polygon)) {
      coords = Array.isArray(polygon[0][0]) ? polygon[0] : polygon;
    }

    if (coords.length < 3) return '';

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [lng, lat] of coords) {
      if (lng < minX) minX = lng;
      if (lng > maxX) maxX = lng;
      if (lat < minY) minY = lat;
      if (lat > maxY) maxY = lat;
    }

    const spanX = maxX - minX || 0.001;
    const spanY = maxY - minY || 0.001;
    const pad = 4;
    const size = 36;

    const points = coords.map(([lng, lat]) => {
      const x = pad + ((lng - minX) / spanX) * (size - pad * 2);
      const y = pad + ((maxY - lat) / spanY) * (size - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return `
      <svg viewBox="0 0 44 44" fill="none">
        <polygon points="${points}" fill="#10b981" fill-opacity="0.25" stroke="#10b981" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
    `;
  }

  update(field, computation, indexName = 'NDVI') {
    this.lastComputation = computation;
    this.lastIndexName = indexName;
    this.lastField = field;

    const emptyState = document.getElementById('indices-empty-state');
    const content = document.getElementById('indices-content');
    if (emptyState) emptyState.style.display = 'none';
    if (content) content.style.display = 'block';

    const stats = computation.stats || computation.statistics || {};
    const mean = typeof stats.mean === 'number' ? stats.mean : 0;

    // Mini Hero do Talhão Ativo (Alvo Certo)
    const heroName = document.getElementById('active-field-hero-name');
    const heroSub = document.getElementById('active-field-hero-sub');
    const mainValEl = document.getElementById('stat-main-value');
    const mainBadgeEl = document.getElementById('stat-main-badge');
    const indexTitleEl = document.getElementById('stat-index-name');

    if (heroName) heroName.textContent = field.name || 'Talhão Sem Nome';
    if (heroSub) {
      const area = computation.areaHectares || stats.areaHectares || field.areaHectares || 0;
      heroSub.textContent = `${field.crop || 'SAF Agroflorestal'} • ${area.toFixed(1)} ha`;
    }
    if (indexTitleEl) indexTitleEl.textContent = indexName === 'RGB' ? 'Visualização Óptica' : `${indexName} Médio`;
    if (mainValEl) {
      if (indexName === 'ELEVATION') mainValEl.textContent = `${mean.toFixed(1)} m`;
      else if (indexName === 'SLOPE') mainValEl.textContent = `${mean.toFixed(1)}°`;
      else if (indexName === 'RGB') mainValEl.textContent = 'Cor Natural';
      else mainValEl.textContent = mean.toFixed(3);
    }

    // Classificação agronômica do vigor
    let badgeClass = 'badge-good';
    let badgeText = 'BOM';
    if (indexName === 'RGB') {
      badgeText = 'COR NATURAL';
      badgeClass = 'badge-good';
    } else {
      const vigorClass = computation.diagnostic?.vigorClass || computation.summary?.vigorClass;
      if (vigorClass && ['EXCELENTE', 'BOM', 'MODERADO', 'CRITICO'].includes(vigorClass.toUpperCase())) {
        badgeText = vigorClass.toUpperCase();
        if (badgeText === 'EXCELENTE') badgeClass = 'badge-excellent';
        else if (badgeText === 'BOM') badgeClass = 'badge-good';
        else if (badgeText === 'MODERADO') badgeClass = 'badge-moderate';
        else badgeClass = 'badge-critical';
      } else {
        if (mean >= 0.70) {
          badgeClass = 'badge-excellent';
          badgeText = 'EXCELENTE';
        } else if (mean >= 0.55) {
          badgeClass = 'badge-good';
          badgeText = 'BOM';
        } else if (mean >= 0.35) {
          badgeClass = 'badge-moderate';
          badgeText = 'MODERADO';
        } else {
          badgeClass = 'badge-critical';
          badgeText = 'CRITICO';
        }
      }
    }

    if (mainBadgeEl) {
      mainBadgeEl.className = `badge ${badgeClass}`;
      mainBadgeEl.textContent = badgeText;
    }

    // Tabela 1: Métricas Gerais & Estatísticas
    const metricMean = document.getElementById('metric-mean');
    const metricMinMax = document.getElementById('metric-minmax');
    const metricStdDev = document.getElementById('metric-stddev');
    const metricPercentiles = document.getElementById('metric-percentiles');
    const metricArea = document.getElementById('metric-area');

    if (metricMean) {
      if (indexName === 'ELEVATION') metricMean.textContent = `${mean.toFixed(1)} m`;
      else if (indexName === 'SLOPE') metricMean.textContent = `${mean.toFixed(1)}°`;
      else if (indexName === 'RGB') metricMean.textContent = 'True Color (B4/B3/B2)';
      else metricMean.textContent = mean.toFixed(3);
    }
    if (metricMinMax) {
      if (indexName === 'RGB') {
        metricMinMax.textContent = '10m / pixel';
      } else {
        const min = typeof stats.min === 'number' ? stats.min.toFixed(2) : '-';
        const max = typeof stats.max === 'number' ? stats.max.toFixed(2) : '-';
        metricMinMax.textContent = `${min} / ${max}`;
      }
    }
    if (metricStdDev) {
      if (indexName === 'RGB') {
        metricStdDev.textContent = '24-bit sRGB';
      } else {
        const stdDev = typeof stats.stdDev === 'number' ? stats.stdDev.toFixed(3) : '-';
        metricStdDev.textContent = `±${stdDev}`;
      }
    }
    if (metricPercentiles) {
      if (indexName === 'RGB') {
        metricPercentiles.textContent = 'Sem Nuvens';
      } else {
        const p10 = typeof stats.p10 === 'number' ? stats.p10.toFixed(2) : '-';
        const p90 = typeof stats.p90 === 'number' ? stats.p90.toFixed(2) : '-';
        metricPercentiles.textContent = `${p10} / ${p90}`;
      }
    }
    if (metricArea) {
      const area = computation.areaHectares || stats.areaHectares || field.areaHectares || 0;
      metricArea.textContent = `${area.toFixed(2)} ha`;
    }

    // Tabela 2: Distribuição por Faixas de Vigor
    const tbody = document.getElementById('vigor-distribution-tbody');
    const distribution = this._extractDistribution(computation, indexName);
    this.lastDistribution = distribution;

    if (tbody) {
      tbody.innerHTML = distribution.map(d => `
        <tr>
          <td><span class="color-swatch" style="background:${d.color || '#10b981'};"></span> ${d.range || ''}</td>
          <td>${d.className || '-'}</td>
          <td class="td-val">${d.areaHa ? d.areaHa.toFixed(2) + ' ha' : '-'}</td>
          <td class="td-val">${d.areaPct ? d.areaPct.toFixed(1) + '%' : '-'}</td>
        </tr>
      `).join('');
    }

    // Legenda Flutuante
    const legendTitle = document.getElementById('legend-index-title');
    const legendMin = document.getElementById('legend-min');
    const legendMid = document.getElementById('legend-mid');
    const legendMax = document.getElementById('legend-max');

    if (indexName === 'RGB') {
      if (legendTitle) legendTitle.textContent = 'Composição Óptica RGB (10m)';
      if (legendMin) legendMin.textContent = 'B04 (Red)';
      if (legendMid) legendMid.textContent = 'B03 (Green)';
      if (legendMax) legendMax.textContent = 'B02 (Blue)';
    } else {
      if (legendTitle) legendTitle.textContent = `Escala ${indexName}`;
      if (legendMin && typeof stats.min === 'number') legendMin.textContent = stats.min.toFixed(2);
      if (legendMid && typeof stats.mean === 'number') legendMid.textContent = stats.mean.toFixed(2);
      if (legendMax && typeof stats.max === 'number') legendMax.textContent = stats.max.toFixed(2);
    }
  }

  _extractDistribution(computation, indexName = '') {
    const totalArea = Number(computation.areaHectares || computation.stats?.areaHectares || 23.4);

    if (indexName === 'RGB' || computation.indexType === 'RGB') {
      return [
        { color: '#ef4444', range: 'B04 (665 nm)', className: 'Vermelho (Red) • 10m', areaHa: totalArea, areaPct: 100 },
        { color: '#22c55e', range: 'B03 (560 nm)', className: 'Verde (Green) • 10m', areaHa: totalArea, areaPct: 100 },
        { color: '#3b82f6', range: 'B02 (490 nm)', className: 'Azul (Blue) • 10m', areaHa: totalArea, areaPct: 100 }
      ];
    }

    // 1. Se vectorLayer estiver presente (zonas de manejo vetoriais com área)
    if (computation.vectorLayer?.features?.length > 0) {
      const zoneMap = new Map();
      let totalFeatArea = 0;
      for (const f of computation.vectorLayer.features) {
        const p = f.properties || {};
        const key = p.className || `Classe ${p.class ?? 'N/A'}`;
        if (!zoneMap.has(key)) {
          zoneMap.set(key, {
            className: key,
            color: p.color || p.fill || '#10b981',
            areaHa: 0,
            range: p.range || '-'
          });
        }
        const z = zoneMap.get(key);
        const aHa = Number(p.areaHa || 0);
        z.areaHa += aHa;
        totalFeatArea += aHa;
      }
      if (totalFeatArea > 0) {
        return Array.from(zoneMap.values()).map(z => ({
          ...z,
          areaPct: (z.areaHa / totalFeatArea) * 100
        }));
      }
    }

    // 2. Se spatialGrid estiver presente, calcula a distribuição REAL pixel a pixel
    const grid = computation.spatialGrid;
    const legend = computation.legend;
    if (grid?.values && Array.isArray(grid.values) && Array.isArray(legend) && legend.length > 0) {
      const counts = new Array(legend.length).fill(0);
      let totalValidPixels = 0;

      const rows = grid.rows || grid.values.length;
      const cols = grid.cols || (Array.isArray(grid.values[0]) ? grid.values[0].length : 12);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const val = Array.isArray(grid.values[r]) ? grid.values[r][c] : grid.values[r * cols + c];
          if (val === null || val === undefined || isNaN(val)) continue;
          totalValidPixels++;

          const idx = legend.findIndex(l => val >= l.min && val <= l.max);
          if (idx !== -1) {
            counts[idx]++;
          } else if (val < legend[0].min) {
            counts[0]++;
          } else {
            counts[legend.length - 1]++;
          }
        }
      }

      if (totalValidPixels > 0) {
        return legend.map((l, i) => {
          const pct = (counts[i] / totalValidPixels) * 100;
          return {
            color: l.colorHex,
            range: `${l.min} a ${l.max}`,
            className: l.label,
            areaHa: (totalArea * pct) / 100,
            areaPct: pct
          };
        });
      }
    }

    // 3. Fallback se não houver matriz
    if (Array.isArray(legend) && legend.length > 0) {
      const evenPct = 100 / legend.length;
      return legend.map(l => ({
        color: l.colorHex,
        range: `${l.min} a ${l.max}`,
        className: l.label,
        areaHa: (totalArea * evenPct) / 100,
        areaPct: evenPct
      }));
    }

    return [];
  }

  updateHistoricalChart(historicalSeries = [], activeDate, onDateClick) {
    this.lastHistoricalSeries = historicalSeries;
    this.activeHistoricalDate = activeDate;
    this.onDateChangeCallback = onDateClick;

    const labelEl = document.getElementById('chart-active-date-label');
    if (labelEl) labelEl.textContent = activeDate || '';

    const canvas = document.getElementById('historical-chart-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.clientWidth || 320;
    const height = 80;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    ctx.clearRect(0, 0, width, height);

    if (!historicalSeries || historicalSeries.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '11px Quicksand';
      ctx.textAlign = 'center';
      ctx.fillText('Série temporal não disponível', width / 2, height / 2);
      return;
    }

    const padLeft = 24;
    const padRight = 16;
    const padTop = 14;
    const padBottom = 20;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const n = historicalSeries.length;
    const points = historicalSeries.map((item, idx) => {
      const x = padLeft + (idx / Math.max(1, n - 1)) * plotW;
      const val = item.mean ?? 0.8;
      const normY = Math.max(0, Math.min(1, (val - 0.5) / 0.5));
      const y = padTop + (1 - normY) * plotH;
      return { x, y, item, idx };
    });

    this.chartPoints = points;

    // Linha de tendência suave esmeralda
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Área sob a curva
    ctx.lineTo(points[points.length - 1].x, height - padBottom);
    ctx.lineTo(points[0].x, height - padBottom);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padTop, 0, height - padBottom);
    grad.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
    grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Pontos clicáveis
    points.forEach(p => {
      const isActive = p.item.date === activeDate;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isActive ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#34d399' : '#003732';
      ctx.fill();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = isActive ? 2.5 : 1.5;
      ctx.stroke();

      ctx.fillStyle = isActive ? '#34d399' : '#64748b';
      ctx.font = '9px Quicksand';
      ctx.textAlign = 'center';
      const shortDate = p.item.date ? p.item.date.split('-').slice(1).join('/') : '';
      ctx.fillText(shortDate, p.x, height - 6);
    });

    canvas.onclick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      let nearest = null;
      let minDist = Infinity;
      for (const p of this.chartPoints || []) {
        const dist = Math.abs(p.x - clickX);
        if (dist < minDist) {
          minDist = dist;
          nearest = p;
        }
      }
      if (nearest && nearest.item.date && this.onDateChangeCallback) {
        this.onDateChangeCallback(nearest.item.date);
      }
    };
  }

  reset() {
    this.lastComputation = null;
    this.lastDistribution = [];
    const emptyState = document.getElementById('indices-empty-state');
    const content = document.getElementById('indices-content');
    if (emptyState) emptyState.style.display = 'block';
    if (content) content.style.display = 'none';
  }

  updateDateSelector(historicalSeries = [], activeDate, onDateChange) {
    const select = document.getElementById('date-select');
    const cloudTag = document.getElementById('cloud-quality-tag');
    if (!select) return;

    if (!historicalSeries || historicalSeries.length === 0) {
      select.innerHTML = '<option value="">Sem passagens orbitais</option>';
      if (cloudTag) cloudTag.textContent = 'Sem dados';
      return;
    }

    select.innerHTML = historicalSeries.map(item => {
      const isSelected = item.date === activeDate;
      const cloud = item.cloudCoverPct !== undefined ? ` (${Math.round(item.cloudCoverPct)}% nuvens)` : '';
      return `<option value="${item.date}" ${isSelected ? 'selected' : ''}>${item.date}${cloud}</option>`;
    }).join('');

    const activeItem = historicalSeries.find(i => i.date === activeDate) || historicalSeries[0];
    if (cloudTag && activeItem) {
      const c = activeItem.cloudCoverPct ?? 0;
      if (c < 10) {
        cloudTag.textContent = 'Excelente (Limpa)';
        cloudTag.style.color = '#34d399';
      } else if (c < 30) {
        cloudTag.textContent = 'Boa (Parcial)';
        cloudTag.style.color = '#facc15';
      } else {
        cloudTag.textContent = 'Nublada';
        cloudTag.style.color = '#f87171';
      }
    }

    select.onchange = (e) => {
      if (onDateChange) onDateChange(e.target.value);
    };

    this.updateHistoricalChart(historicalSeries, activeDate, onDateChange);
  }

  exportCSV(indexName = 'NDVI') {
    if (!this.lastComputation) {
      alert('Nenhum dado analítico disponível para exportação.');
      return;
    }

    const stats = this.lastComputation.stats || this.lastComputation.statistics || {};
    const fieldName = this.lastField?.name || 'Talhao';
    const lines = [
      'Relatório de Monitoramento Biofísico - Muito Verde (SIAAGRO 2026)',
      `Talhão:;${fieldName}`,
      `Índice Espectral:;${indexName}`,
      `Data de Emissão:;${new Date().toLocaleString('pt-BR')}`,
      '',
      'Métricas Gerais',
      `Média:;${(stats.mean || 0).toFixed(4)}`,
      `Mínimo:;${(stats.min || 0).toFixed(4)}`,
      `Máximo:;${(stats.max || 0).toFixed(4)}`,
      `Desvio Padrão:;${(stats.stdDev || 0).toFixed(4)}`,
      `Área Total (ha):;${(this.lastComputation.areaHectares || 0).toFixed(2)}`,
      '',
      'Distribuição por Faixas de Vigor',
      'Faixa;Classificação;Área (ha);Percentual (%)'
    ];

    const distribution = this.lastDistribution || this._extractDistribution(this.lastComputation);
    for (const d of distribution) {
      lines.push(`"${d.range || ''}";"${d.className || ''}";${(d.areaHa || 0).toFixed(2)};${(d.areaPct || 0).toFixed(1)}%`);
    }

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio_${indexName.toLowerCase()}_${fieldName.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

export const statsView = new StatsView();
