class AuthModalView {
  constructor() {
    this.modalEl = null;
    this.currentView = 'login'; // 'login' | 'signup' | 'forgot'
    this.onLoginCallback = null;
    this.onLogoutCallback = null;
  }

  init(onLoginCallback, onLogoutCallback) {
    this.onLoginCallback = onLoginCallback;
    this.onLogoutCallback = onLogoutCallback;
    this.modalEl = document.getElementById('auth-modal');

    const authForm = document.getElementById('auth-form');
    const signupForm = document.getElementById('signup-form');
    const forgotForm = document.getElementById('forgot-form');

    const closeBtn = document.getElementById('auth-modal-close');
    const authBtn = document.getElementById('auth-btn');
    const logoutBtn = document.getElementById('btn-logout');

    const switchSignupBtn = document.getElementById('btn-switch-signup');
    const switchForgotBtn = document.getElementById('btn-switch-forgot');
    const backToLoginBtns = document.querySelectorAll('.btn-back-to-login');

    if (authBtn) {
      authBtn.addEventListener('click', () => this.open('login'));
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        if (this.onLogoutCallback) {
          await this.onLogoutCallback();
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    if (this.modalEl) {
      this.modalEl.addEventListener('click', (e) => {
        if (e.target === this.modalEl) this.close();
      });
    }

    // Alternância de views no modal
    if (switchSignupBtn) {
      switchSignupBtn.addEventListener('click', () => window.open('https://muitoverde.com.br/login?view=signup', '_blank', 'noopener'));
    }
    if (switchForgotBtn) {
      switchForgotBtn.addEventListener('click', () => window.open('https://muitoverde.com.br/login', '_blank', 'noopener'));
    }
    backToLoginBtns.forEach(btn => {
      btn.addEventListener('click', () => this.switchView('login'));
    });

    // Submissão Login (Autenticação na plataforma com backend integrado via .env.local)
    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById('auth-email');
        const passInput = document.getElementById('auth-password');
        const email = emailInput ? emailInput.value.trim() : '';
        const password = passInput ? passInput.value : '';
        if (this.onLoginCallback) {
          const button = authForm.querySelector('[type="submit"]');
          button.disabled = true; button.textContent = 'Entrando…';
          try { await this.onLoginCallback({ email, password }); }
          finally { button.disabled = false; button.textContent = 'Entrar na Plataforma'; passInput.value = ''; }
        }
      });
    }

    if (signupForm) signupForm.addEventListener('submit', e => {
      e.preventDefault(); window.open('https://muitoverde.com.br/login?view=signup', '_blank', 'noopener');
    });
    if (forgotForm) forgotForm.addEventListener('submit', e => {
      e.preventDefault(); window.open('https://muitoverde.com.br/login', '_blank', 'noopener');
    });
  }

  open(view = 'login') {
    if (!this.modalEl) return;
    this.switchView(view);
    this.clearError();
    this.modalEl.style.display = 'flex';
    const input = document.getElementById('auth-email');
    if (input) input.focus();
  }

  close() {
    if (!this.modalEl) return;
    this.modalEl.style.display = 'none';
    this.clearError();
  }

  switchView(view) {
    this.currentView = view;
    const loginView = document.getElementById('auth-subview-login');
    const signupView = document.getElementById('auth-subview-signup');
    const forgotView = document.getElementById('auth-subview-forgot');

    const titleEl = document.getElementById('auth-view-title');
    const descEl = document.getElementById('auth-view-desc');

    if (loginView) loginView.style.display = view === 'login' ? 'flex' : 'none';
    if (signupView) signupView.style.display = view === 'signup' ? 'flex' : 'none';
    if (forgotView) forgotView.style.display = view === 'forgot' ? 'flex' : 'none';

    if (view === 'login') {
      if (titleEl) titleEl.textContent = 'Acesse sua conta';
      if (descEl) descEl.textContent = 'Entre com suas credenciais para acessar a plataforma.';
    } else if (view === 'signup') {
      if (titleEl) titleEl.textContent = 'Criar nova conta';
      if (descEl) descEl.textContent = 'Preencha os dados abaixo para começar gratuitamente.';
    } else if (view === 'forgot') {
      if (titleEl) titleEl.textContent = 'Recuperar senha';
      if (descEl) descEl.textContent = 'Digite seu email para receber instruções de recuperação.';
    }
    this.clearError();
  }

  showError(message) {
    const errorEl = document.getElementById('auth-error-msg');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  }

  clearError() {
    const errorEl = document.getElementById('auth-error-msg');
    const signupErr = document.getElementById('signup-error-msg');
    const forgotErr = document.getElementById('forgot-error-msg');
    if (errorEl) errorEl.style.display = 'none';
    if (signupErr) signupErr.style.display = 'none';
    if (forgotErr) forgotErr.style.display = 'none';
  }

  updateHeader(session) {
    const walletChips = document.getElementById('wallet-chips');
    const authBtn = document.getElementById('auth-btn');
    const userBadge = document.getElementById('user-badge');
    const userInitial = document.getElementById('user-avatar-initial');
    const userDisplayName = document.getElementById('user-display-name');

    const valTier = document.getElementById('val-tier');
    const valQuota = document.getElementById('val-quota');
    const valWallet = document.getElementById('val-wallet');
    const valCredits = document.getElementById('val-credits');

    if (session && session.authenticated) {
      if (walletChips) walletChips.style.display = 'flex';
      if (authBtn) authBtn.style.display = 'none';
      if (userBadge) userBadge.style.display = 'flex';

      const userName = session.user?.name || 'Produtor Muito Verde';
      if (userDisplayName) userDisplayName.textContent = userName;
      if (userInitial) userInitial.textContent = userName.charAt(0).toUpperCase();

      if (valTier) valTier.textContent = session.wallet?.tier || 'BÁSICO';
      if (valQuota) valQuota.textContent = session.wallet?.quota || '42.5 / 100 ha';
      if (valWallet) valWallet.textContent = session.wallet?.balance || '1.250 MV';
      if (valCredits) {
        const creds = session.wallet?.credits ?? 0;
        valCredits.textContent = `${Number(creds).toLocaleString('pt-BR')} CR`;
      }
    } else {
      if (walletChips) walletChips.style.display = 'none';
      if (authBtn) authBtn.style.display = 'inline-flex';
      if (userBadge) userBadge.style.display = 'none';
    }
  }
}

export const authModalView = new AuthModalView();
