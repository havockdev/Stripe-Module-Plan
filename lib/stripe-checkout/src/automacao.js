/**
 * automacao.js
 *
 * Classe principal de automação do Stripe Checkout.
 *
 * Porta fiel da classe `StripeAutomation` do módulo original, com todos os
 * nomes de variáveis, métodos e comentários traduzidos para português brasileiro.
 *
 * Usa Playwright (Firefox + display virtual) para:
 * - Abrir a página de checkout e extrair a chave pública do Stripe
 * - Capturar cookies e identificadores de rastreamento (guid, muid, sid)
 * - Aplicar cupons de desconto via interação com a interface do usuário
 *
 * As etapas de criação de método de pagamento e confirmação usam HTTP direto
 * (sem browser), chamando as APIs públicas do Stripe.
 */

import { firefox } from 'playwright';
import fetch from 'node-fetch';
import { registrar, gerarUuid } from './utilitarios.js';
import { iniciarTunelProxy, pararTunelProxy } from './tunel-proxy.js';

/**
 * Resolve um hCaptcha enterprise via API ezcaptcha.
 *
 * @param {Object} opcoes
 * @param {string} opcoes.siteKey   - Site key do hCaptcha fornecido pelo Stripe
 * @param {string} opcoes.rqdata    - Token rqdata/enterprise payload capturado do /init do Stripe
 * @param {string} opcoes.websiteUrl - URL atual da página de checkout
 * @returns {Promise<string>} Token hCaptcha resolvido (gRecaptchaResponse)
 */
async function resolverCaptchaEzcaptcha({ siteKey, rqdata, websiteUrl }) {
  const chaveApi = process.env.EZCAPTCHA_API_KEY;
  if (!chaveApi) throw new Error('EZCAPTCHA_API_KEY não configurada');

  const corpo = {
    clientKey: chaveApi,
    task: {
      type: 'HCaptchaTaskProxyless',
      websiteURL: websiteUrl,
      websiteKey: siteKey,
      ...(rqdata ? { enterprisePayload: { rqdata } } : {}),
    },
  };

  registrar(`[EZCAPTCHA] Criando tarefa hCaptcha... websiteKey=${siteKey} rqdata=${rqdata ? 'sim' : 'não'}`, 'info');

  const respCriar = await fetch('https://api.ezcaptcha.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dadosCriar = await respCriar.json();

  if (dadosCriar.errorId !== 0) {
    throw new Error(`ezcaptcha createTask erro ${dadosCriar.errorId}: ${dadosCriar.errorDescription || ''}`);
  }

  const taskId = dadosCriar.taskId;
  registrar(`[EZCAPTCHA] Tarefa criada: taskId=${taskId} — aguardando resolução (máx 120s)...`, 'info');

  // Polling a cada 3s, máximo de 40 tentativas (120s)
  for (let tentativa = 0; tentativa < 40; tentativa++) {
    await new Promise((r) => setTimeout(r, 3000));

    const respResultado = await fetch('https://api.ezcaptcha.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: chaveApi, taskId }),
    });
    const dadosResultado = await respResultado.json();

    if (dadosResultado.errorId !== 0) {
      throw new Error(`ezcaptcha getTaskResult erro ${dadosResultado.errorId}: ${dadosResultado.errorDescription || ''}`);
    }

    if (dadosResultado.status === 'ready') {
      const token = dadosResultado.solution?.gRecaptchaResponse;
      if (!token) throw new Error('ezcaptcha retornou status ready mas sem gRecaptchaResponse');
      registrar(`[EZCAPTCHA] Captcha resolvido em ~${(tentativa + 1) * 3}s`, 'success');
      return token;
    }

    if (tentativa % 5 === 4) {
      registrar(`[EZCAPTCHA] Ainda aguardando... (${(tentativa + 1) * 3}s)`, 'info');
    }
  }

  throw new Error('ezcaptcha timeout — captcha não resolvido em 120s');
}

/**
 * Classe de automação completa do Stripe Checkout.
 * Encapsula todo o fluxo de assinatura de um novo plano.
 *
 * @example
 * const automacao = new AutomacaoCheckout(link)
 * await automacao.inicializar()
 * await automacao.extrairDadosSessao()
 * await automacao.aplicarCupons(['COMM-MARC-8314'])
 * const idMetodo = await automacao.criarMetodoPagamento(dadosCartao, dadosEndereco)
 * const resultado = await automacao.confirmarPagamento(idMetodo)
 * await automacao.fechar()
 */
export class AutomacaoCheckout {
  /**
   * @param {string} urlCheckout - URL completa da sessão de checkout do Stripe
   *   Exemplo: https://checkout.stripe.com/c/pay/cs_live_xxx#...
   * @param {string} [proxy=''] - Proxy no formato "host:porta:usuario:senha".
   *   Passe string vazia ou omita para não usar proxy.
   *   Exemplo: "geo.iproyal.com:12321:usuario:senha_session-xxx"
   */
  constructor(urlCheckout, proxy = '') {
    this.urlCheckout = urlCheckout;

    /**
     * Configuração do proxy para o contexto Playwright.
     * null = sem proxy. Preenchido no construtor se proxy for fornecido.
     * @type {{server: string, username: string, password: string}|null}
     */
    this.proxy = null;
    if (proxy && proxy.trim()) {
      // Formatos aceitos:
      //   socks5://host:porta:usuario:senha  → SOCKS5
      //   http://host:porta:usuario:senha    → HTTP explícito
      //   host:porta:usuario:senha           → HTTP (padrão)
      // A senha pode conter ':' — tudo após o 3º separador faz parte dela.
      const str = proxy.trim();
      let protocolo = 'http';
      let resto = str;

      if (str.startsWith('socks5://')) {
        protocolo = 'socks5';
        resto = str.slice('socks5://'.length);
      } else if (str.startsWith('http://')) {
        protocolo = 'http';
        resto = str.slice('http://'.length);
      }

      const partes = resto.split(':');
      const host = partes[0];
      const porta = partes[1];
      const usuario = partes[2];
      const senha = partes.slice(3).join(':');
      this.proxy = { server: `${protocolo}://${host}:${porta}`, username: usuario, password: senha };
      registrar(`Proxy configurado: ${protocolo}://${host}:${porta} (usuário: ${usuario})`, 'info');
    }

    /** @type {import('playwright').Browser|null} */
    this.navegador = null;

    /** @type {import('playwright').BrowserContext|null} */
    this.contexto = null;

    /** @type {import('playwright').Page|null} */
    this.pagina = null;

    /**
     * Servidor HTTP local de túnel SOCKS5→HTTP.
     * Usado quando o proxy é SOCKS5 (Firefox não suporta auth SOCKS5 nativamente).
     * @type {import('http').Server|null}
     */
    this.servidorTunel = null;

    /**
     * Dados internos da sessão Stripe coletados durante a automação.
     * Preenchidos pelos métodos inicializar() e extrairDadosSessao().
     */
    this.dadosStripe = {
      /** ID da sessão de checkout (cs_live_xxx) — extraído da URL */
      idSessao: null,
      /** Chave pública do Stripe (pk_live_xxx) — extraída do HTML da página */
      chavePublica: null,
      /** Identificador de rastreamento do dispositivo — capturado ou gerado aleatoriamente */
      guid: null,
      /** Identificador de rastreamento do navegador — capturado ou gerado aleatoriamente */
      muid: null,
      /** Identificador de rastreamento da sessão — capturado ou gerado aleatoriamente */
      sid: null,
      /** Cookies da sessão do browser, usados no header Cookie da confirmação */
      cookies: [],
      /** User-Agent do Firefox simulado nas requisições */
      agenteUsuario:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
      /** ID de configuração do checkout — capturado dos eventos do Stripe */
      idConfiguracaoCheckout: null,
      /** UUID único desta sessão de automação */
      idSessaoCliente: gerarUuid(),
      /** Valor real da sessão em centavos — capturado de total_summary.total na resposta da API */
      valorEsperado: 0,
      /**
       * Indica se já há desconto aplicado na sessão, determinado pela API do Stripe
       * (total_summary.total < total_summary.subtotal).
       */
      descontoAplicado: null,
      /**
       * EID retornado pelo servidor no /init — obrigatório no confirm.
       * Diferente de "NA" que é o valor padrão do cliente; o servidor gera um UUID real.
       */
      eid: 'NA',
      /**
       * Token de bot detection (PerimeterX/rqdata) retornado pelo /init.
       * Necessário para que o Stripe aceite o confirm como legítimo.
       */
      rqdata: null,
      /**
       * Checksum de inicialização retornado pelo /init.
       * Valida que o estado da sessão não foi adulterado entre init e confirm.
       */
      initChecksum: null,
    };
  }

  /**
   * Inicializa o navegador Firefox com configurações de evasão de detecção.
   *
   * Configura o contexto do browser com:
   * - Resolução 1920x1080
   * - Locale pt-BR e fuso horário America/Sao_Paulo
   * - User-Agent do Firefox
   * - Scripts de inicialização para ocultar a detecção de WebDriver
   * - Interceptor de requisições para capturar guid, muid, sid e checkoutConfigId
   *
   * Roda em modo visível (headless: false) sobre o display virtual do sistema
   * (variável de ambiente DISPLAY, ex: ":0"). O hCaptcha Invisível usa fingerprinting
   * sofisticado e rejeita o token em modo headless, resultando em status "open".
   * Com headless: false e display virtual, o fingerprint é idêntico ao de um navegador real.
   *
   * @returns {Promise<void>}
   * @throws {Error} Se o Playwright não conseguir lançar o Firefox
   */
  async inicializar() {
    registrar('Inicializando navegador Firefox (display virtual) com evasão de detecção...', 'info');

    this.navegador = await firefox.launch({
      headless: false,
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':0',
      },
      firefoxUserPrefs: {
        'dom.webdriver.enabled': false,
        'privacy.resistFingerprinting': false,
        'browser.cache.disk.enable': false,
        'browser.cache.memory.enable': false,
        'network.http.use-cache': false,
      },
    });

    const opcoesContexto = {
      viewport: { width: 1920, height: 1080 },
      userAgent: this.dadosStripe.agenteUsuario,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
    };

    // Configura proxy no contexto
    // Se for SOCKS5: Firefox não suporta auth SOCKS5 nativamente, então iniciamos
    // um túnel HTTP local (localhost:porta) que repassa via SOCKS5 autenticado.
    if (this.proxy) {
      if (this.proxy.server.startsWith('socks5://')) {
        registrar('Proxy SOCKS5 detectado — iniciando túnel HTTP local...', 'info');
        const { servidor, porta } = await iniciarTunelProxy(this.proxy);
        this.servidorTunel = servidor;
        opcoesContexto.proxy = { server: `http://127.0.0.1:${porta}` };
        registrar(`Túnel local iniciado na porta ${porta} → ${this.proxy.server}`, 'info');
      } else {
        opcoesContexto.proxy = this.proxy;
        registrar(`Contexto Playwright criado com proxy HTTP: ${this.proxy.server}`, 'info');
      }
    }

    this.contexto = await this.navegador.newContext(opcoesContexto);

    // Oculta os indicadores de automação do WebDriver
    await this.contexto.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['pt-BR', 'pt', 'en-US', 'en'],
      });
    });

    this.pagina = await this.contexto.newPage();

    // Intercepta requisições para capturar os identificadores de rastreamento do Stripe.js
    // O Stripe.js envia guid, muid e sid para api.stripe.com e r.stripe.com antes de qualquer ação do usuário.
    this.pagina.on('request', (requisicao) => {
      const url = requisicao.url();
      if (url.includes('api.stripe.com') || url.includes('r.stripe.com')) {
        const dadosPost = requisicao.postData();
        if (dadosPost) {
          try {
            const parametros = new URLSearchParams(dadosPost);
            if (parametros.has('guid')) this.dadosStripe.guid = parametros.get('guid');
            if (parametros.has('muid')) this.dadosStripe.muid = parametros.get('muid');
            if (parametros.has('sid')) this.dadosStripe.sid = parametros.get('sid');

            if (parametros.has('events')) {
              const eventos = JSON.parse(parametros.get('events'));
              if (eventos?.length > 0 && eventos[0].checkout_config_id) {
                this.dadosStripe.idConfiguracaoCheckout = eventos[0].checkout_config_id;
              }
            }
          } catch (_ignorado) {
            // Ignora erros de parse — nem todas as requisições têm formato URLSearchParams
          }
        }
      }
    });

  }

  /**
   * Aguarda e captura uma resposta da API do Stripe que contenha amount_total,
   * atualizando dadosStripe.valorEsperado com o valor real da sessão.
   * Usa waitForResponse para garantia de timing — sem risco de race condition.
   *
   * @param {import('playwright').Page} pagina - Página do Playwright
   * @param {Function} acao - Função async que dispara a requisição a ser aguardada
   * @param {number} [timeout=10000] - Tempo máximo de espera em ms
   * @returns {Promise<void>}
   */
  async capturarValorSessao(acao, timeout = 10000) {
    const idSessao = this.dadosStripe.idSessao;
    try {
      // waitForResponse deve vir ANTES de acao() para garantir que o listener
      // está registrado antes da requisição disparar — elimina race condition.
      const [resposta] = await Promise.all([
        this.pagina.waitForResponse(
          (resp) =>
            resp.url().includes(`/v1/payment_pages/${idSessao}`) &&
            resp.url().includes('api.stripe.com') &&
            !resp.url().includes('check_active') &&
            !resp.url().includes('confirm') &&
            resp.status() === 200,
          { timeout },
        ),
        acao(),
      ]);

      const dados = await resposta.json();

      // O Stripe Checkout v3 não usa amount_total no body da resposta.
      // O valor real da sessão está em total_summary.total (campo aninhado).
      // Fallbacks em ordem de prioridade:
      //   1. total_summary.total  — campo principal do Stripe Checkout v3
      //   2. invoice.amount_due   — valor da fatura (presente em modo subscription)
      //   3. amount_total         — campo legado de versões antigas
      const valor =
        dados?.total_summary?.total ??
        dados?.invoice?.amount_due ??
        dados?.amount_total;

      if (typeof valor === 'number') {
        this.dadosStripe.valorEsperado = valor;
        registrar(
          `Valor real da sessão capturado: ${valor} centavos (total_summary.total)`,
          'success',
        );
      } else {
        registrar(`Resposta não contém valor da sessão. Campos: ${Object.keys(dados || {}).slice(0, 6).join(', ')}`, 'info');
      }

      // Detecta se há desconto aplicado usando os dados da API (confiável):
      // total_summary.total < total_summary.subtotal → cupom reduz o total
      const descontos = dados?.recurring_details?.total_discount_amounts ?? dados?.total_details?.breakdown?.discounts ?? [];
      const subtotal = dados?.total_summary?.subtotal ?? 0;
      const total = dados?.total_summary?.total ?? 0;
      const temDesconto = descontos.length > 0 || (subtotal > 0 && total < subtotal);
      this.dadosStripe.descontoAplicado = temDesconto;
      registrar(
        `Desconto na sessão (via API): ${temDesconto ? 'SIM ✓' : 'NÃO'} | descontos: ${descontos.length} | subtotal: ${subtotal} | total: ${total}`,
        'info',
      );

      // Captura campos obrigatórios para o confirm: eid (UUID real do servidor),
      // rqdata (token de bot detection) e init_checksum (nonce de validação da sessão).
      if (dados?.eid && dados.eid !== 'NA') {
        this.dadosStripe.eid = dados.eid;
        registrar(`EID do servidor capturado: ${dados.eid}`, 'info');
      }
      if (dados?.rqdata) {
        this.dadosStripe.rqdata = dados.rqdata;
        registrar(`rqdata capturado (${String(dados.rqdata).length} chars)`, 'info');
      }
      if (dados?.init_checksum) {
        this.dadosStripe.initChecksum = dados.init_checksum;
        registrar(`init_checksum capturado: ${dados.init_checksum}`, 'info');
      }
    } catch (_ignorado) {
      // Não bloqueia o fluxo se a resposta não chegar dentro do timeout
      registrar('Não foi possível capturar valor da sessão desta resposta — usando valor atual.', 'info');
    }
  }

  /**
   * Abre a URL de checkout no browser, extrai a chave pública do Stripe e coleta cookies.
   *
   * Fluxo:
   * 1. Extrai o idSessao (cs_live_xxx) diretamente da URL por regex
   * 2. Navega até a URL de checkout e aguarda o carregamento
   * 3. Extrai a chave pública pk_live_xxx do HTML da página (e scripts embutidos como fallback)
   * 4. Coleta os cookies da sessão do browser
   * 5. Gera guid/muid/sid aleatórios se não capturados do interceptor de requisições
   *
   * @returns {Promise<void>}
   * @throws {Error} Se o formato da URL for inválido
   * @throws {Error} Se a chave pública pk_live_xxx não for encontrada na página
   */
  async extrairDadosSessao() {
    registrar('Extraindo dados da sessão...', 'info');

    // Extrai o ID da sessão da URL: /pay/cs_live_xxx#... → cs_live_xxx
    try {
      const partesUrl = this.urlCheckout.split('/pay/');
      if (partesUrl.length > 1) {
        this.dadosStripe.idSessao = partesUrl[1].split('#')[0].split('?')[0];
        registrar(`ID da sessão extraído: ${this.dadosStripe.idSessao}`, 'success');
      } else {
        throw new Error('Formato de URL inválido. Não foi possível extrair o ID da sessão.');
      }
    } catch (erro) {
      registrar(`Erro ao extrair ID da sessão: ${erro.message}`, 'error');
      throw erro;
    }

    // Carrega a página e captura o amount_total da resposta do /init em paralelo.
    // waitForResponse garante que o valor é lido antes de continuarmos — sem race condition.
    registrar('Acessando página de checkout e capturando valor da sessão...', 'info');
    await this.capturarValorSessao(
      () => this.pagina.goto(this.urlCheckout, { waitUntil: 'domcontentloaded', timeout: 90000 }),
      20000,
    );

    // Aguarda o Stripe.js terminar de configurar cookies (__stripe_mid, __stripe_sid, m)
    await this.pagina.waitForTimeout(5000);

    registrar('Buscando chave pública do Stripe...', 'info');
    const html = await this.pagina.content();
    const correspondenciaChave = html.match(/pk_live_[a-zA-Z0-9]+/);

    if (correspondenciaChave) {
      this.dadosStripe.chavePublica = correspondenciaChave[0];
      registrar(
        `Chave pública extraída do HTML: ${this.dadosStripe.chavePublica.substring(0, 15)}...`,
        'success',
      );
    } else {
      // Fallback: tenta extrair dos scripts embutidos na página
      registrar(
        'Chave pública não encontrada no HTML principal. Tentando nos scripts embutidos...',
        'warning',
      );
      const scripts = await this.pagina.$$eval('script', (elementos) =>
        elementos.map((s) => s.textContent),
      );
      for (const script of scripts) {
        if (script) {
          const correspondencia = script.match(/pk_live_[a-zA-Z0-9]+/);
          if (correspondencia) {
            this.dadosStripe.chavePublica = correspondencia[0];
            registrar(
              `Chave pública extraída de script embutido: ${this.dadosStripe.chavePublica.substring(0, 15)}...`,
              'success',
            );
            break;
          }
        }
      }
    }

    if (!this.dadosStripe.chavePublica) {
      throw new Error(
        'Chave pública do Stripe (pk_live_xxx) não encontrada na página de checkout.',
      );
    }

    // Coleta todos os cookies da sessão do browser (necessários para confirmar o pagamento)
    this.dadosStripe.cookies = await this.contexto.cookies();

    // Os cookies do Stripe.js têm formato: {UUID-36-chars}{6-chars-checksum}
    // Ex: c385920d-fa43-467c-a8bc-c16419e6b9e55a48e3 → UUID = primeiros 36 chars
    // Precisamos extrair apenas o UUID (36 chars) para enviar à API.
    const extrairUuid = (valor) => (valor && valor.length >= 36 ? valor.substring(0, 36) : valor);

    // __stripe_mid → muid (Machine Unique ID, identifica o dispositivo)
    const cookieMid = this.dadosStripe.cookies.find((c) => c.name === '__stripe_mid');
    if (cookieMid) {
      this.dadosStripe.muid = extrairUuid(cookieMid.value);
      registrar(`MUID extraído do cookie __stripe_mid: ${this.dadosStripe.muid.substring(0, 8)}... (${this.dadosStripe.muid.length} chars)`, 'success');
    }

    // __stripe_sid → sid (Session ID, identifica a sessão do browser)
    const cookieSid = this.dadosStripe.cookies.find((c) => c.name === '__stripe_sid');
    if (cookieSid) {
      this.dadosStripe.sid = extrairUuid(cookieSid.value);
      registrar(`SID extraído do cookie __stripe_sid: ${this.dadosStripe.sid.substring(0, 8)}... (${this.dadosStripe.sid.length} chars)`, 'success');
    }

    // Cookie 'm' no domínio m.stripe.com → guid (GUID do dispositivo, gerado pelo m.stripe.com fingerprinting)
    // Formato: {UUID-36-chars}{6-chars-checksum}, ex: f8e45428-9745-49f8-9995-b8ef6e2187713838fa
    const cookieM = this.dadosStripe.cookies.find(
      (c) => c.name === 'm' && (c.domain.includes('m.stripe.com') || c.domain.includes('m.stripe')),
    );
    if (cookieM) {
      this.dadosStripe.guid = extrairUuid(cookieM.value);
      registrar(`GUID extraído do cookie m (m.stripe.com): ${this.dadosStripe.guid.substring(0, 8)}... (${this.dadosStripe.guid.length} chars)`, 'success');
    }

    // Fallback: tenta localStorage se guid ainda não foi capturado
    if (!this.dadosStripe.guid) {
      try {
        const guidLocal = await this.pagina.evaluate(() => {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.includes('guid') || k.includes('gr_guid'))) {
              return localStorage.getItem(k);
            }
          }
          return null;
        });
        if (guidLocal) {
          this.dadosStripe.guid = extrairUuid(guidLocal);
          registrar(`GUID extraído do localStorage: ${this.dadosStripe.guid.substring(0, 8)}...`, 'success');
        }
      } catch (_ignorado) {}
    }

    // Fallback final: gera UUIDs aleatórios se ainda não foram capturados
    if (!this.dadosStripe.guid) {
      this.dadosStripe.guid = gerarUuid();
      registrar('GUID não capturado — usando UUID gerado aleatoriamente.', 'warning');
    }
    if (!this.dadosStripe.muid) {
      this.dadosStripe.muid = gerarUuid();
      registrar('MUID não capturado — usando UUID gerado aleatoriamente.', 'warning');
    }
    if (!this.dadosStripe.sid) {
      this.dadosStripe.sid = gerarUuid();
      registrar('SID não capturado — usando UUID gerado aleatoriamente.', 'warning');
    }

    registrar(
      `IDs de rastreamento: GUID=${this.dadosStripe.guid.substring(0, 8)}..., MUID=${this.dadosStripe.muid.substring(0, 8)}..., SID=${this.dadosStripe.sid.substring(0, 8)}...`,
      'info',
    );
  }

  /**
   * Aplica um ou mais códigos de cupom de desconto na página de checkout via Playwright.
   *
   * Verifica primeiro se já há um desconto aplicado na página.
   * Tenta cada código da lista em ordem e para no primeiro que funcionar.
   *
   * @param {string[]} [codigos=[]] - Lista de códigos de cupom a tentar
   * @returns {Promise<boolean>} true se algum cupom foi aplicado, false caso contrário
   */
  async aplicarCupons(codigos = []) {
    registrar('Iniciando processo de aplicação de cupons...', 'info');

    if (codigos.length === 0) {
      registrar('Nenhum código de cupom fornecido. Pulando etapa.', 'info');
      return false;
    }

    // Usa o dado da API (capturado pelo interceptor durante o carregamento da página)
    // para verificar se o desconto já está aplicado — muito mais confiável que HTML parsing,
    // que dispara falsos positivos (ex: botão "Add promotion code" contém a palavra "promotion").
    if (this.dadosStripe.descontoAplicado === true) {
      registrar(
        `Desconto já confirmado pela API (${this.dadosStripe.valorEsperado} centavos = preço com desconto). Pulando etapa de cupons...`,
        'success',
      );
      return true;
    }

    // Fallback via HTML apenas se a API não retornou dados de desconto.
    // Usa verificações específicas que só aparecem quando o desconto ESTÁ aplicado:
    // valores negativos no resumo do pedido, não palavras genéricas do botão "Add promotion code".
    if (this.dadosStripe.descontoAplicado === null) {
      const conteudoPaginaInicial = (await this.pagina.content()).toLowerCase();
      const descontoNoHtml =
        conteudoPaginaInicial.includes('- r$') ||
        conteudoPaginaInicial.includes('- us$') ||
        conteudoPaginaInicial.includes('-$');
      if (descontoNoHtml) {
        registrar('Desconto detectado via HTML (valor negativo no resumo). Pulando etapa de cupons...', 'success');
        return true;
      }
    }

    // Tenta abrir o campo de código promocional clicando no botão (se existir)
    try {
      const botaoPromo = this.pagina.locator('[data-testid="product-summary-promo-code"]');
      if (await botaoPromo.isVisible({ timeout: 5000 })) {
        registrar('Botão de código promocional encontrado. Clicando...', 'info');
        await botaoPromo.click();
        await this.pagina.waitForTimeout(1000);
      }
    } catch (_ignorado) {
      registrar('Botão de código promocional não encontrado ou já expandido.', 'info');
    }

    // Localiza o campo de texto do cupom
    const campoCupom = this.pagina.getByRole('textbox', {
      name: /Adicionar código promocional|Add promotion code/i,
    });

    try {
      await campoCupom.waitFor({ state: 'visible', timeout: 10000 });
    } catch (_ignorado) {
      registrar(
        'Campo de código promocional não encontrado. A página pode não aceitar cupons.',
        'warning',
      );
      return false;
    }

    let cupomAplicado = false;

    for (const codigo of codigos) {
      registrar(`Testando cupom: ${codigo}`, 'info');

      // Limpa o campo e digita o código
      await campoCupom.click();
      await this.pagina.keyboard.press('Control+A');
      await this.pagina.keyboard.press('Backspace');
      await this.pagina.waitForTimeout(500);

      await campoCupom.fill(codigo);
      await this.pagina.waitForTimeout(500);

      // Pressiona Enter e captura o amount_total atualizado em paralelo (com timeout generoso de 8s).
      // O Stripe.js faz uma chamada à API quando o cupom é submetido — capturamos o novo valor.
      registrar('Submetendo cupom e aguardando resposta da API Stripe...', 'info');
      await this.capturarValorSessao(
        () => this.pagina.keyboard.press('Enter'),
        8000,
      );

      await this.pagina.waitForTimeout(2000);

      const conteudoPagina = (await this.pagina.content()).toLowerCase();

      // Verifica se o cupom foi rejeitado explicitamente
      if (
        conteudoPagina.includes('código inválido') ||
        conteudoPagina.includes('invalid promotion code') ||
        conteudoPagina.includes('invalid coupon') ||
        conteudoPagina.includes('cupom inválido')
      ) {
        registrar(`Cupom ${codigo} é INVÁLIDO.`, 'warning');
        continue;
      }

      // Verifica se o desconto apareceu na página (qualquer indicador de desconto)
      const descontoNaPagina =
        conteudoPagina.includes('desconto') ||
        conteudoPagina.includes('discount') ||
        conteudoPagina.includes('promotion') ||
        conteudoPagina.includes('código promocional') ||
        conteudoPagina.includes('-$') ||
        conteudoPagina.includes('- r$') ||
        conteudoPagina.includes('- us$');

      if (descontoNaPagina) {
        registrar(`Cupom ${codigo} APLICADO COM SUCESSO! (valorEsperado: ${this.dadosStripe.valorEsperado} centavos)`, 'success');
        cupomAplicado = true;
        break;
      }

      // Fallback: se não há mensagem de erro visível, assume que o cupom foi aceito
      const erroVisivel = await this.pagina
        .locator('text=/Código inválido|Invalid promotion code/i')
        .isVisible()
        .catch(() => false);

      if (!erroVisivel) {
        registrar(`Cupom ${codigo} parece ter sido aceito (sem erro visível). valorEsperado: ${this.dadosStripe.valorEsperado} centavos.`, 'success');
        cupomAplicado = true;
        break;
      }
    }

    if (!cupomAplicado) {
      registrar('Nenhum cupom válido encontrado na lista fornecida.', 'warning');
    }

    return cupomAplicado;
  }

  /**
   * Preenche o formulário de cartão no browser e confirma o pagamento via Stripe.js nativo.
   *
   * Esta abordagem usa o próprio Playwright para preencher os campos do formulário de checkout
   * (email, número do cartão, validade, CVC) e clicar em "Pagar/Assinar", exatamente como
   * o usuário faria manualmente. O Stripe.js do browser cuida do hCaptcha invisível,
   * do token de bot detection e da chamada ao /confirm — eliminando o problema de
   * "open/unpaid" causado por tentar chamar /confirm diretamente via fetch.
   *
   * Estratégia de localização dos campos:
   * - Itera pelos frames da página para encontrar inputs do Stripe Elements
   * - Card number: placeholder "Card number" ou similar
   * - Expiry: placeholder "MM / YY"
   * - CVC: placeholder "CVC" ou "Security code"
   * - Email: input type=email no frame principal ou no frame de checkout
   *
   * @param {Object} dadosCartao - Dados do cartão
   * @param {string} dadosCartao.numero - Número do cartão (com ou sem espaços)
   * @param {string} dadosCartao.cvv - CVC/CVV
   * @param {string} dadosCartao.mesVencimento - Mês ('01'..'12')
   * @param {string} dadosCartao.anoVencimento - Ano (2 dígitos, ex: '34')
   * @param {Object} dadosEndereco - Dados do titular
   * @param {string} dadosEndereco.nome - Nome completo
   * @param {string} dadosEndereco.email - E-mail
   * @returns {Promise<{sucesso: boolean, status: string, mensagem: string}>}
   */
  async preencherCartaoEConfirmar(dadosCartao, dadosEndereco) {
    registrar('Preenchendo formulário de cartão no browser (via Playwright)...', 'info');

    /**
     * Localiza um input em qualquer frame da página usando um predicado.
     * Retorna o ElementHandle do input encontrado ou null.
     *
     * @param {Function} predicado - Função async (frame) => ElementHandle|null
     * @returns {Promise<{frame, elemento}|null>}
     */
    const localizarEmFrames = async (predicado) => {
      for (const frame of this.pagina.frames()) {
        try {
          const el = await predicado(frame);
          if (el) return { frame, elemento: el };
        } catch (_) {
          // Frame pode estar inacessível (cross-origin isolado) — continua
        }
      }
      return null;
    };

    // Aguarda os frames do Stripe.js carregarem completamente
    // (o checkout usa Stripe Elements que montam iframes internos)
    await this.pagina.waitForTimeout(4000);

    // ── Email (se existir na página) ──────────────────────────────────────────
    const emailEncontrado = await localizarEmFrames(async (frame) => {
      return await frame.$('input[type="email"], input[autocomplete="email"]');
    });
    if (emailEncontrado) {
      await emailEncontrado.elemento.fill(dadosEndereco.email);
      registrar(`E-mail preenchido: ${dadosEndereco.email}`, 'info');
    } else {
      registrar('Campo de e-mail não encontrado (já preenchido ou ausente na sessão).', 'info');
    }

    // ── Número do cartão ───────────────────────────────────────────────────────
    // Seletores confirmados via diagnóstico do checkout.stripe.com em PT-BR:
    //   name="cardNumber", placeholder="1234 1234 1234 1234", id="cardNumber"
    const numeroEncontrado = await localizarEmFrames(async (frame) => {
      return await frame.$(
        'input[name="cardNumber"], input[id="cardNumber"], ' +
        'input[placeholder="1234 1234 1234 1234"], input[aria-label*="cartão"], ' +
        'input[aria-label*="Card number"], input[autocomplete="cc-number"]'
      );
    });
    if (!numeroEncontrado) {
      throw new Error('Campo de número do cartão não encontrado nos frames da página.');
    }
    const numeroSemEspacos = dadosCartao.numero.replace(/\s+/g, '');
    // Usa elemento.type() — despacha eventos no contexto do frame do elemento.
    // Tab ao final aciona blur+validação no Stripe.js (remove classe --incomplete do botão).
    await numeroEncontrado.elemento.type(numeroSemEspacos, { delay: 60 });
    await numeroEncontrado.elemento.press('Tab');
    await this.pagina.waitForTimeout(300);
    registrar('Número do cartão preenchido.', 'info');

    // ── Validade ──────────────────────────────────────────────────────────────
    // Seletores confirmados: name="cardExpiry", placeholder="MM / AA" (PT-BR)
    const validadeEncontrada = await localizarEmFrames(async (frame) => {
      return await frame.$(
        'input[name="cardExpiry"], input[id="cardExpiry"], ' +
        'input[placeholder="MM / AA"], input[placeholder="MM / YY"], ' +
        'input[placeholder="MM/YY"], input[autocomplete="cc-exp"]'
      );
    });
    if (!validadeEncontrada) {
      throw new Error('Campo de validade do cartão não encontrado nos frames da página.');
    }
    const validade = `${dadosCartao.mesVencimento}${dadosCartao.anoVencimento}`;
    await validadeEncontrada.elemento.type(validade, { delay: 80 });
    await validadeEncontrada.elemento.press('Tab');
    await this.pagina.waitForTimeout(300);
    registrar('Validade do cartão preenchida.', 'info');

    // ── CVC ───────────────────────────────────────────────────────────────────
    // Seletores confirmados: name="cardCvc", id="cardCvc"
    const cvcEncontrado = await localizarEmFrames(async (frame) => {
      return await frame.$(
        'input[name="cardCvc"], input[id="cardCvc"], ' +
        'input[placeholder="CVC"], input[placeholder="CVV"], ' +
        'input[aria-label*="segurança"], input[autocomplete="cc-csc"]'
      );
    });
    if (!cvcEncontrado) {
      throw new Error('Campo de CVC não encontrado nos frames da página.');
    }
    await cvcEncontrado.elemento.type(dadosCartao.cvv, { delay: 80 });
    await cvcEncontrado.elemento.press('Tab');
    await this.pagina.waitForTimeout(300);
    registrar('CVC preenchido.', 'info');

    // ── Campos de endereço de cobrança ─────────────────────────────────────────
    // O Stripe Checkout v3 requer todos os campos de billing preenchidos para habilitar o botão.
    //
    // Ordem crítica:
    // 1. billingName
    // 2. billingCountry (SELECT) — selecionar BR antes de revelar campos dependentes
    // 3. billingAddressLine1 + Tab → revela campos ocultos (billingLocality, billingAdministrativeArea, billingPostalCode)
    // 4. billingAdministrativeArea (SELECT de estado) — obrigatório para o Brasil
    // 5. billingLocality (cidade)
    // 6. billingPostalCode (CEP)

    // Nome do titular
    const elNome = await localizarEmFrames(f => f.$('input[name="billingName"]'));
    if (elNome) {
      await elNome.elemento.fill(dadosEndereco.nome);
      await elNome.elemento.press('Tab');
      registrar('Nome do titular preenchido.', 'info');
    }

    // País — SELECT billingCountry (deve ser preenchido ANTES do endereço para revelar campos corretos)
    if (dadosEndereco.pais) {
      const elPais = await localizarEmFrames(f => f.$('select[name="billingCountry"]'));
      if (elPais) {
        await elPais.elemento.selectOption(dadosEndereco.pais.toUpperCase());
        await this.pagina.waitForTimeout(600); // aguarda re-renderização dos campos de endereço
        registrar(`País selecionado: ${dadosEndereco.pais.toUpperCase()}`, 'info');
      } else {
        registrar('Campo de país não encontrado (pode já estar definido na sessão).', 'info');
      }
    }

    // Endereço linha 1 — ao pressionar Tab, os campos ocultos (cidade, estado, CEP) são revelados
    const elRua = await localizarEmFrames(f => f.$('input[name="billingAddressLine1"]'));
    if (elRua) {
      await elRua.elemento.type(dadosEndereco.rua, { delay: 50 });
      await elRua.elemento.press('Tab');
      await this.pagina.waitForTimeout(800); // aguarda renderização dos campos ocultos
      registrar('Endereço linha 1 preenchido.', 'info');
    }

    // Estado/UF — SELECT billingAdministrativeArea
    // Para BR: usar código UF de 2 letras (ex: 'MS', 'SP', 'RJ')
    const elEstado = await localizarEmFrames(f => f.$('select[name="billingAdministrativeArea"]'));
    if (elEstado && dadosEndereco.estado) {
      await elEstado.elemento.selectOption(dadosEndereco.estado.toUpperCase());
      await this.pagina.waitForTimeout(300);
      registrar(`Estado selecionado: ${dadosEndereco.estado.toUpperCase()}`, 'info');
    }

    // Cidade
    const elCidade = await localizarEmFrames(f => f.$('input[name="billingLocality"]'));
    if (elCidade) {
      await elCidade.elemento.fill(dadosEndereco.cidade);
      await elCidade.elemento.press('Tab');
      registrar('Cidade preenchida.', 'info');
    }

    // CEP
    const elCep = await localizarEmFrames(f => f.$('input[name="billingPostalCode"]'));
    if (elCep) {
      await elCep.elemento.fill(dadosEndereco.cep);
      await elCep.elemento.press('Tab');
      registrar('CEP preenchido.', 'info');
    }

    // Aguarda o Stripe.js processar todos os campos e remover a classe --incomplete do botão
    await this.pagina.waitForTimeout(2000);

    // ── Botão de pagamento ────────────────────────────────────────────────────
    registrar('Clicando no botão de pagamento...', 'info');
    // Seletor confirmado via diagnóstico: data-testid="hosted-payment-submit-button"
    const botaoPagar = await localizarEmFrames(async (frame) => {
      return await frame.$(
        'button[data-testid="hosted-payment-submit-button"], button[type="submit"]'
      );
    });
    if (!botaoPagar) {
      throw new Error('Botão de pagamento não encontrado nos frames da página.');
    }

    // Registra o listener ANTES de clicar — elimina race condition.
    // O Stripe.js do browser cuida de hCaptcha invisível, validação e confirm.
    let respostaConfirm = null;
    const promessaRespostaConfirm = this.pagina.waitForResponse(
      (resp) =>
        resp.url().includes(`/v1/payment_pages/${this.dadosStripe.idSessao}/confirm`) &&
        resp.status() === 200,
      { timeout: 50000 },
    );

    // Snapshot dos frames hcaptcha existentes ANTES do clique
    // (o captcha invisível do botão já criou frames — precisamos identificar os NOVOS)
    const framesHcaptchaAntesDoClique = new Set(
      this.pagina.frames()
        .filter(f => f.url().includes('newassets.hcaptcha.com') && f.url().includes('hcaptcha.html'))
        .map(f => f.url())
    );
    registrar(`[CAPTCHA] Frames hcaptcha antes do clique: ${framesHcaptchaAntesDoClique.size}`, 'info');

    await botaoPagar.elemento.click();
    registrar('Botão de pagamento clicado — aguardando Stripe.js processar (hCaptcha + confirm)...', 'info');

    // Aguarda a resposta do confirm com timeout de 60s.
    // Em paralelo, monitora navegação para URL de sucesso (caso o Stripe redirecione).
    // Para assinaturas com total 0 (cupom 100%), o Stripe pode redirecionar sem passar pelo confirm.
    const urlSucesso = (url) => !url.includes('checkout.stripe.com/c/pay/');
    const [respostaHttp, redirecionado] = await Promise.all([
      promessaRespostaConfirm.catch(() => null),
      this.pagina.waitForURL(urlSucesso, { timeout: 60000 }).then(() => true).catch(() => false),
    ]);

    if (respostaHttp) {
      respostaConfirm = await respostaHttp.json().catch(() => null);
    }

    // Analisa o resultado
    if (respostaConfirm) {
      const statusSessao = respostaConfirm.status;
      const statusPagamento = respostaConfirm.payment_status;
      registrar(`Status da sessão (confirm): ${statusSessao}`, 'info');
      registrar(`Status do pagamento: ${statusPagamento}`, 'info');

      // Log diagnóstico completo da resposta do confirm
      const camposRelevantes = {
        status: respostaConfirm.status,
        payment_status: respostaConfirm.payment_status,
        error: respostaConfirm.error || null,
        next_action: respostaConfirm.payment_intent?.next_action?.type || respostaConfirm.next_action?.type || null,
        intent_status: respostaConfirm.payment_intent?.status || null,
        intent_last_error: respostaConfirm.payment_intent?.last_payment_error?.code || null,
        intent_decline_code: respostaConfirm.payment_intent?.last_payment_error?.decline_code || null,
        setup_intent_status: respostaConfirm.setup_intent?.status || null,
        setup_next_action: respostaConfirm.setup_intent?.next_action?.type || null,
        chaves_raiz: Object.keys(respostaConfirm).join(', '),
      };
      registrar(`[DIAGNÓSTICO CONFIRM] ${JSON.stringify(camposRelevantes)}`, 'info');

      if (respostaConfirm.error) {
        const erro = respostaConfirm.error;
        registrar(`Erro retornado pelo Stripe: ${erro.message}`, 'warning');
        registrar(`Código: ${erro.code || 'N/A'} | Recusa: ${erro.decline_code || 'N/A'}`, 'warning');

        if (erro.type === 'card_error') {
          return { sucesso: true, status: 'card_declined', mensagem: erro.message };
        }
        return { sucesso: false, status: 'error', mensagem: erro.message };
      }

      if (statusSessao === 'complete') {
        registrar('Pagamento confirmado com sucesso! Sessão concluída.', 'success');
        return { sucesso: true, status: 'paid', mensagem: 'Pagamento confirmado' };
      }

      if (statusSessao === 'open') {
        // setup_intent requires_action/use_stripe_sdk:
        // O Stripe.js do browser precisa resolver a ação antes do confirm final.
        // Pode ser (a) SCA silencioso (device fingerprint 3DS2) → Stripe.js resolve automaticamente
        // ou      (b) 3DS interativo (popup bancário) → banco exige ação do usuário.
        // Estratégia: NÃO desistir no primeiro confirm. Aguardar Stripe.js chamar /confirm novamente
        // ou redirecionar para success_url. Só reportar erro 3DS se não acontecer nada em 60s.
        const si = respostaConfirm.setup_intent;
        const requerAcaoSCA =
          si?.status === 'requires_action' &&
          si?.next_action?.type === 'use_stripe_sdk';

        if (requerAcaoSCA) {
          const tipoNextAction = si?.next_action?.use_stripe_sdk?.type || 'desconhecido';
          registrar(
            `[SCA] setup_intent requires_action | subtipo: ${tipoNextAction} | id: ${si?.id?.substring(0, 30)}`,
            'info'
          );

          // ── intent_confirmation_challenge: hCaptcha enterprise via ezcaptcha ──────
          // O Stripe exige verificação hCaptcha enterprise antes de confirmar o setup_intent.
          // Solução: resolver via API ezcaptcha, obter token e submeter ao /verify_challenge.
          if (tipoNextAction === 'intent_confirmation_challenge') {
            const sdkData = si?.next_action?.use_stripe_sdk?.stripe_js || {};
            // verification_url pode vir relativo (/v1/...) ou absoluto
            const verifyUrl = sdkData.verification_url || '';
            // O Stripe pode usar 'hcaptcha_site_key' ou 'site_key' dependendo da versão
            const siteKey = sdkData.hcaptcha_site_key || sdkData.site_key || '';
            // Prioriza rqdata do sdkData (challenge atual) com fallback para o capturado no /init
            const rqdataCaptcha = sdkData.rqdata || this.dadosStripe.rqdata || '';
            const websiteUrl = this.pagina.url();

            // Log completo do sdkData para diagnóstico (ajuda a identificar o campo correto)
            registrar(
              `[CAPTCHA] intent_confirmation_challenge detectado. sdkData keys=${Object.keys(sdkData).join(',')} siteKey=${siteKey} verification_url=${verifyUrl}`,
              'info'
            );

            if (!siteKey || !verifyUrl) {
              registrar(`[CAPTCHA] siteKey ou verification_url ausentes. sdkData completo: ${JSON.stringify(sdkData)}`, 'warning');
              return {
                sucesso: false,
                status: 'error',
                mensagem: 'Stripe retornou intent_confirmation_challenge sem siteKey ou verification_url',
              };
            }

            // Registra listeners ANTES de resolver (sem race condition)
            const promessaSegundoConfirmCaptcha = this.pagina.waitForResponse(
              (resp) =>
                resp.url().includes(`/v1/payment_pages/${this.dadosStripe.idSessao}/confirm`) &&
                resp.status() === 200,
              { timeout: 120000 },
            );
            const promessaRedirectCaptcha = this.pagina
              .waitForURL(urlSucesso, { timeout: 120000 })
              .then(() => true)
              .catch(() => false);

            // Resolve o captcha via ezcaptcha
            let tokenCaptcha = null;
            try {
              tokenCaptcha = await resolverCaptchaEzcaptcha({ siteKey, rqdata: rqdataCaptcha, websiteUrl });
              registrar(`[CAPTCHA] Token ezcaptcha obtido (${tokenCaptcha.length} chars)`, 'success');
            } catch (errEz) {
              registrar(`[CAPTCHA] Falha ao resolver via ezcaptcha: ${errEz.message}`, 'warning');
              return {
                sucesso: false,
                status: 'error',
                mensagem: `Falha ao resolver captcha via ezcaptcha: ${errEz.message}`,
              };
            }

            // Submete o token ao endpoint /verify_challenge do Stripe via fetch no contexto do browser
            // (o browser já possui os cookies e headers de autenticação do Stripe.js)
            registrar(`[CAPTCHA] Submetendo token ao Stripe: ${verifyUrl}`, 'info');
            try {
              const respostaVerify = await this.pagina.evaluate(
                async ({ url, token }) => {
                  const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: `hcaptcha_token=${encodeURIComponent(token)}`,
                    credentials: 'include',
                  });
                  const texto = await resp.text();
                  return { status: resp.status, corpo: texto };
                },
                {
                  url: verifyUrl.startsWith('http') ? verifyUrl : `https://api.stripe.com${verifyUrl}`,
                  token: tokenCaptcha,
                }
              );
              registrar(`[CAPTCHA] verify_challenge respondeu: status=${respostaVerify.status} corpo=${respostaVerify.corpo.substring(0, 200)}`, 'info');
            } catch (errVerify) {
              registrar(`[CAPTCHA] Erro ao submeter token ao Stripe: ${errVerify.message}`, 'warning');
            }

            // Aguarda segundo /confirm OU redirect (até 120s — ezcaptcha pode demorar)
            registrar('[CAPTCHA] Aguardando Stripe processar após captcha (até 120s)...', 'info');
            const [segundaRespCaptcha, redirecionadoCaptcha] = await Promise.all([
              promessaSegundoConfirmCaptcha.catch(() => null),
              promessaRedirectCaptcha,
            ]);

            if (redirecionadoCaptcha || urlSucesso(this.pagina.url())) {
              registrar('[CAPTCHA] Redirecionamento detectado — captcha resolvido e pagamento confirmado!', 'success');
              return { sucesso: true, status: 'paid', mensagem: 'Pagamento confirmado (captcha resolvido via ezcaptcha)' };
            }

            if (segundaRespCaptcha) {
              const dadosSegundo = await segundaRespCaptcha.json().catch(() => null);
              if (dadosSegundo) {
                const s2Status = dadosSegundo.status;
                registrar(`[CAPTCHA] Segundo confirm recebido: status=${s2Status}`, 'info');

                if (s2Status === 'complete') {
                  registrar('[CAPTCHA] Pagamento confirmado após captcha resolvido!', 'success');
                  return { sucesso: true, status: 'paid', mensagem: 'Pagamento confirmado (captcha resolvido via ezcaptcha)' };
                }

                if (dadosSegundo.error) {
                  const erro = dadosSegundo.error;
                  registrar(`[CAPTCHA] Erro no segundo confirm: ${erro.message} | tipo: ${erro.type}`, 'warning');
                  if (erro.type === 'card_error') {
                    return { sucesso: false, status: 'card_declined', mensagem: erro.message };
                  }
                  return { sucesso: false, status: 'error', mensagem: erro.message };
                }
              }
            }

            registrar('[CAPTCHA] Sem segundo confirm nem redirect após submissão do token — captcha não aceito pelo Stripe', 'warning');
            return {
              sucesso: false,
              status: 'error',
              mensagem: 'Stripe não aceitou o token do captcha — sem segundo confirm nem redirect',
            };
          }

          // ── Outros subtipos use_stripe_sdk (ex: three_d_secure_redirect) ──────────
          // Aguarda Stripe.js completar a ação e chamar /confirm novamente, ou redirect.
          registrar(
            `[SCA] Subtipo ${tipoNextAction} — aguardando Stripe.js completar ação...`,
            'info'
          );

          // Registra o listener para o SEGUNDO confirm ANTES de aguardar (sem race condition)
          const promessaSegundoConfirm = this.pagina.waitForResponse(
            (resp) =>
              resp.url().includes(`/v1/payment_pages/${this.dadosStripe.idSessao}/confirm`) &&
              resp.status() === 200,
            { timeout: 65000 },
          );

          // Aguarda segundo confirm OU redirecionamento para URL de sucesso
          const [segundaRespHttp, redirecionadoPosSCA] = await Promise.all([
            promessaSegundoConfirm.catch(() => null),
            this.pagina.waitForURL(urlSucesso, { timeout: 65000 }).then(() => true).catch(() => false),
          ]);

          // Redirecionamento → SCA completado com sucesso
          if (redirecionadoPosSCA || urlSucesso(this.pagina.url())) {
            registrar('Redirecionamento detectado após SCA — pagamento concluído.', 'success');
            return { sucesso: true, status: 'paid', mensagem: 'Pagamento confirmado (SCA completado)' };
          }

          // Segundo confirm recebido → analisa resultado
          if (segundaRespHttp) {
            const segundoConfirm = await segundaRespHttp.json().catch(() => null);
            if (segundoConfirm) {
              const s2Status = segundoConfirm.status;
              registrar(`[SCA] Segundo confirm: status=${s2Status}`, 'info');

              if (s2Status === 'complete') {
                registrar('Pagamento confirmado após SCA.', 'success');
                return { sucesso: true, status: 'paid', mensagem: 'Pagamento confirmado (SCA)' };
              }

              if (segundoConfirm.error) {
                const erro = segundoConfirm.error;
                registrar(`Erro no segundo confirm: ${erro.message} | tipo: ${erro.type} | código: ${erro.decline_code || erro.code || 'N/A'}`, 'warning');
                if (erro.type === 'card_error') {
                  return { sucesso: false, status: 'card_declined', mensagem: erro.message };
                }
                return { sucesso: false, status: 'error', mensagem: erro.message };
              }

              if (s2Status === 'open') {
                const redirectPosSCA = await this.pagina.waitForURL(urlSucesso, { timeout: 30000 }).then(() => true).catch(() => false);
                if (redirectPosSCA) {
                  return { sucesso: true, status: 'paid', mensagem: 'Pagamento confirmado (SCA + redirect tardio)' };
                }
              }
            }
          }

          // Sem segundo confirm nem redirect → 3DS interativo real
          registrar(
            `[3DS] Autenticação bancária interativa (${tipoNextAction}) — banco exige verificação manual. Automação não consegue resolver.`,
            'warning'
          );
          return {
            sucesso: false,
            status: 'error',
            mensagem: 'Conta exige autenticação 3DS — o banco bloqueou a confirmação automática',
          };
        }

        // Status open sem SCA — verifica redirect já acontecido
        if (redirecionado || urlSucesso(this.pagina.url())) {
          registrar('Redirecionamento para URL de retorno após status open — pagamento concluído.', 'success');
          return { sucesso: true, status: 'paid', mensagem: 'Pagamento confirmado (redirecionado)' };
        }
        // Aguarda até 40s adicionais por redirect assíncrono (assinaturas podem demorar)
        registrar('Status open recebido — aguardando redirecionamento assíncrono do Stripe...', 'info');
        const redirectTardio = await this.pagina.waitForURL(urlSucesso, { timeout: 40000 }).then(() => true).catch(() => false);
        if (redirectTardio) {
          registrar('Redirecionamento tardio detectado — pagamento concluído.', 'success');
          return { sucesso: true, status: 'paid', mensagem: 'Pagamento confirmado (redirecionamento tardio)' };
        }
        return { sucesso: false, status: 'error', mensagem: 'Pagamento não processado: sessão permanece em aberto e sem redirecionamento.' };
      }

      return { sucesso: false, status: 'error', mensagem: `Status inesperado: ${statusSessao}` };
    }

    // Sem resposta de confirm — verifica URL atual para determinar sucesso
    const urlAtual = this.pagina.url();
    registrar(`URL após clique: ${urlAtual.substring(0, 120)}`, 'info');

    if (redirecionado || urlSucesso(urlAtual)) {
      registrar('Navegação para URL de retorno detectada — pagamento provavelmente concluído.', 'success');
      return { sucesso: true, status: 'paid', mensagem: 'Pagamento concluído (redirecionado para URL de retorno)' };
    }

    // Verifica se o timeout foi causado por captcha visível (hCaptcha challenge)
    // O bframe é o iframe de challenge — aparece quando o Stripe eleva o captcha para visível
    const temCaptchaVisivel = this.pagina.frames().some(
      (f) => f.url().includes('hcaptcha.com') && f.url().includes('bframe')
    );
    if (temCaptchaVisivel) {
      registrar(
        '[CAPTCHA VISÍVEL] hCaptcha challenge detectado na página — Stripe exigiu verificação humana nesta conta/sessão. A automação não consegue resolver captchas visuais.',
        'warning'
      );
      return {
        sucesso: false,
        status: 'error',
        mensagem: 'Captcha visível detectado — Stripe exigiu verificação humana (hCaptcha challenge)',
      };
    }

    return { sucesso: false, status: 'error', mensagem: 'Sem resposta do confirm e sem redirecionamento de sucesso.' };
  }

  /**
   * Fecha o navegador e libera todos os recursos.
   * Deve ser chamado sempre ao final da automação (inclusive em caso de erro).
   *
   * @returns {Promise<void>}
   */
  async fechar() {
    if (this.navegador) {
      registrar('Fechando navegador...', 'info');
      await this.navegador.close();
      this.navegador = null;
      this.contexto = null;
      this.pagina = null;
    }
    if (this.servidorTunel) {
      await pararTunelProxy(this.servidorTunel);
      this.servidorTunel = null;
      registrar('Túnel proxy local encerrado.', 'info');
    }
  }

  /**
   * Executa o fluxo completo de checkout em uma única chamada.
   *
   * Equivalente ao método `run()` do módulo original.
   * O browser é sempre fechado no final, mesmo em caso de erro.
   *
   * Ordem de execução:
   * 1. inicializar() — lança o Firefox headless
   * 2. extrairDadosSessao() — abre a URL, captura eid/rqdata/init_checksum/cookies
   * 3. aplicarCupons(codigos) — aplica cupons via UI (se fornecidos)
   * 4. preencherCartaoEConfirmar(cartao, endereco) — preenche o formulário no browser
   *    e deixa o Stripe.js nativo executar hCaptcha + confirm
   *
   * @param {Object} opcoes - Opções do checkout
   * @param {string[]} [opcoes.codigos=[]] - Lista de códigos de cupom a tentar
   * @param {Object} opcoes.cartao - Dados do cartão (obrigatório)
   * @param {string} opcoes.cartao.numero - Número do cartão
   * @param {string} opcoes.cartao.cvv - Código de segurança
   * @param {string} opcoes.cartao.mesVencimento - Mês de vencimento ('01'..'12')
   * @param {string} opcoes.cartao.anoVencimento - Ano de vencimento (2 dígitos)
   * @param {Object} opcoes.endereco - Dados de endereço e titular (obrigatório)
   * @param {string} opcoes.endereco.nome - Nome completo do titular
   * @param {string} opcoes.endereco.email - E-mail do titular
   * @param {string} opcoes.endereco.pais - Código do país (ex: 'BR')
   * @param {string} opcoes.endereco.rua - Logradouro
   * @param {string} opcoes.endereco.cidade - Cidade
   * @param {string} opcoes.endereco.estado - UF/Estado
   * @param {string} opcoes.endereco.cep - CEP ou código postal
   * @returns {Promise<{sucesso: boolean, status: string, mensagem: string}>}
   */
  async executar(opcoes = {}) {
    const { codigos = [], cartao, endereco } = opcoes;

    try {
      await this.inicializar();
      await this.extrairDadosSessao();
      await this.aplicarCupons(codigos);

      const resultado = await this.preencherCartaoEConfirmar(cartao, endereco);
      return resultado;
    } catch (erro) {
      registrar(`Erro fatal na execução: ${erro.message}`, 'error');
      return { sucesso: false, status: 'error', mensagem: erro.message };
    } finally {
      await this.fechar();
    }
  }
}
