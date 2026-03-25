/**
 * automacao.js
 *
 * Classe principal de automação do Stripe Checkout.
 *
 * Porta fiel da classe `StripeAutomation` do módulo original, com todos os
 * nomes de variáveis, métodos e comentários traduzidos para português brasileiro.
 *
 * Usa Playwright (Firefox headless) para:
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
   */
  constructor(urlCheckout) {
    this.urlCheckout = urlCheckout;

    /** @type {import('playwright').Browser|null} */
    this.navegador = null;

    /** @type {import('playwright').BrowserContext|null} */
    this.contexto = null;

    /** @type {import('playwright').Page|null} */
    this.pagina = null;

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
    };
  }

  /**
   * Inicializa o navegador Firefox headless com configurações de evasão de detecção.
   *
   * Configura o contexto do browser com:
   * - Resolução 1920x1080
   * - Locale pt-BR e fuso horário America/Sao_Paulo
   * - User-Agent do Firefox
   * - Scripts de inicialização para ocultar a detecção de WebDriver
   * - Interceptor de requisições para capturar guid, muid, sid e checkoutConfigId
   *
   * @returns {Promise<void>}
   * @throws {Error} Se o Playwright não conseguir lançar o Firefox
   */
  async inicializar() {
    registrar('Inicializando navegador Firefox com evasão de detecção...', 'info');

    this.navegador = await firefox.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      firefoxUserPrefs: {
        'dom.webdriver.enabled': false,
        'privacy.resistFingerprinting': true,
        'privacy.trackingprotection.enabled': true,
        'browser.cache.disk.enable': false,
        'browser.cache.memory.enable': false,
        'network.http.use-cache': false,
      },
    });

    this.contexto = await this.navegador.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: this.dadosStripe.agenteUsuario,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
    });

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

    registrar('Acessando página de checkout...', 'info');
    await this.pagina.goto(this.urlCheckout, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });

    // Aguarda o Stripe.js carregar e disparar as requisições de rastreamento
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

    // Extrai muid e sid diretamente dos cookies definidos pelo Stripe.js:
    // __stripe_mid → muid (machine ID), __stripe_sid → sid (session ID)
    // Esses cookies são definidos pelo Stripe.js durante o carregamento da página e são
    // mais confiáveis do que capturar os valores das requisições de rede.
    const cookieMid = this.dadosStripe.cookies.find((c) => c.name === '__stripe_mid');
    const cookieSid = this.dadosStripe.cookies.find((c) => c.name === '__stripe_sid');
    if (cookieMid) {
      this.dadosStripe.muid = cookieMid.value;
      registrar(`MUID extraído do cookie __stripe_mid: ${this.dadosStripe.muid.substring(0, 8)}...`, 'success');
    }
    if (cookieSid) {
      this.dadosStripe.sid = cookieSid.value;
      registrar(`SID extraído do cookie __stripe_sid: ${this.dadosStripe.sid.substring(0, 8)}...`, 'success');
    }

    // Tenta extrair o guid do localStorage do Stripe.js (armazenado sob a chave 'gr_guid' ou similar)
    if (!this.dadosStripe.guid) {
      try {
        const guidLocal = await this.pagina.evaluate(() => {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (k.includes('guid') || k.includes('gr_guid') || k === 'guid')) {
              return localStorage.getItem(k);
            }
          }
          return null;
        });
        if (guidLocal) {
          this.dadosStripe.guid = guidLocal;
          registrar(`GUID extraído do localStorage: ${this.dadosStripe.guid.substring(0, 8)}...`, 'success');
        }
      } catch (_ignorado) {}
    }

    // Fallback: gera UUIDs aleatórios se ainda não foram capturados
    if (!this.dadosStripe.guid) this.dadosStripe.guid = gerarUuid();
    if (!this.dadosStripe.muid) this.dadosStripe.muid = gerarUuid();
    if (!this.dadosStripe.sid) this.dadosStripe.sid = gerarUuid();

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

    // Verifica se já há desconto aplicado na página (cupom pré-aplicado no link)
    const conteudoPaginaInicial = await this.pagina.content();
    const descontoJaAplicado =
      conteudoPaginaInicial.includes('US$ 5,00') ||
      conteudoPaginaInicial.includes('US$ 15,00') ||
      conteudoPaginaInicial.includes('desconto') ||
      conteudoPaginaInicial.includes('discount') ||
      conteudoPaginaInicial.includes('-$');

    if (descontoJaAplicado) {
      registrar(
        'Desconto já aplicado na página. Pulando etapa de cupons e seguindo para pagamento...',
        'success',
      );
      return true;
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
      await this.pagina.keyboard.press('Enter');

      registrar('Aguardando validação do cupom...', 'info');
      await this.pagina.waitForTimeout(3000);

      const conteudoPagina = await this.pagina.content();

      // Verifica se o cupom foi rejeitado explicitamente
      if (
        conteudoPagina.includes('Código inválido') ||
        conteudoPagina.includes('Invalid promotion code')
      ) {
        registrar(`Cupom ${codigo} é INVÁLIDO.`, 'warning');
        continue;
      }

      // Verifica se o desconto apareceu na página
      if (
        conteudoPagina.includes('US$ 5,00') ||
        conteudoPagina.includes('US$ 15,00') ||
        conteudoPagina.includes('desconto') ||
        conteudoPagina.includes('discount') ||
        conteudoPagina.includes('-$')
      ) {
        registrar(`Cupom ${codigo} APLICADO COM SUCESSO!`, 'success');
        // Aguarda 4s extras para garantir que o Stripe finalize o estado do cupom no servidor
        // antes de fecharmos o browser e chamarmos a API de confirmação.
        registrar('Aguardando commit do cupom no servidor Stripe (4s)...', 'info');
        await this.pagina.waitForTimeout(4000);
        cupomAplicado = true;
        break;
      }

      // Se não há mensagem de erro visível, assume que o cupom foi aceito
      const erroVisivel = await this.pagina
        .locator('text=/Código inválido|Invalid promotion code/i')
        .isVisible()
        .catch(() => false);

      if (!erroVisivel) {
        registrar(`Cupom ${codigo} parece ter sido aceito (sem mensagem de erro).`, 'success');
        registrar('Aguardando commit do cupom no servidor Stripe (4s)...', 'info');
        await this.pagina.waitForTimeout(4000);
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
   * Cria um método de pagamento no Stripe via API direta (sem browser).
   *
   * Envia os dados do cartão e endereço de cobrança para a API pública do Stripe
   * (`POST https://api.stripe.com/v1/payment_methods`) usando a chave pública
   * extraída na etapa de extração de dados.
   *
   * @param {Object} dadosCartao - Dados do cartão de crédito/débito
   * @param {string} dadosCartao.numero - Número do cartão (com ou sem espaços)
   * @param {string} dadosCartao.cvv - Código de segurança (CVC/CVV)
   * @param {string} dadosCartao.mesVencimento - Mês de vencimento ('01' a '12')
   * @param {string} dadosCartao.anoVencimento - Ano de vencimento (2 dígitos, ex: '34')
   * @param {Object} dadosEndereco - Dados de endereço e identificação do titular
   * @param {string} dadosEndereco.nome - Nome completo do titular
   * @param {string} dadosEndereco.email - E-mail do titular
   * @param {string} dadosEndereco.pais - Código do país (ex: 'BR')
   * @param {string} dadosEndereco.rua - Logradouro completo
   * @param {string} dadosEndereco.cidade - Cidade
   * @param {string} dadosEndereco.estado - UF ou estado (ex: 'MS')
   * @param {string} dadosEndereco.cep - CEP ou código postal
   * @returns {Promise<string>} ID do método de pagamento criado (pm_xxx)
   * @throws {Error} Se a API do Stripe retornar um erro
   */
  async criarMetodoPagamento(dadosCartao, dadosEndereco) {
    registrar('Criando método de pagamento via API...', 'info');

    const urlApi = 'https://api.stripe.com/v1/payment_methods';

    const parametros = new URLSearchParams();
    parametros.append('type', 'card');
    parametros.append('card[number]', dadosCartao.numero);
    parametros.append('card[cvc]', dadosCartao.cvv);
    parametros.append('card[exp_month]', dadosCartao.mesVencimento);
    parametros.append('card[exp_year]', dadosCartao.anoVencimento);
    parametros.append('billing_details[name]', dadosEndereco.nome);
    parametros.append('billing_details[email]', dadosEndereco.email);
    parametros.append('billing_details[address][country]', dadosEndereco.pais);
    parametros.append('billing_details[address][line1]', dadosEndereco.rua);
    parametros.append('billing_details[address][city]', dadosEndereco.cidade);
    parametros.append('billing_details[address][state]', dadosEndereco.estado);
    parametros.append('billing_details[address][postal_code]', dadosEndereco.cep);
    parametros.append('key', this.dadosStripe.chavePublica);
    parametros.append('guid', this.dadosStripe.guid);
    parametros.append('muid', this.dadosStripe.muid);
    parametros.append('sid', this.dadosStripe.sid);
    parametros.append(
      'payment_user_agent',
      'stripe.js/ceeb51e570; stripe-js-v3/ceeb51e570',
    );

    try {
      const resposta = await fetch(urlApi, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': this.dadosStripe.agenteUsuario,
          Origin: 'https://checkout.stripe.com',
          Referer: 'https://checkout.stripe.com/',
        },
        body: parametros,
      });

      const dados = await resposta.json();

      if (dados.error) {
        throw new Error(`Erro ao criar método de pagamento: ${dados.error.message}`);
      }

      registrar(`Método de pagamento criado com sucesso: ${dados.id}`, 'success');
      return dados.id;
    } catch (erro) {
      registrar(`Falha na criação do método de pagamento: ${erro.message}`, 'error');
      throw erro;
    }
  }

  /**
   * Confirma o pagamento via API direta do Stripe (sem browser).
   *
   * Envia o método de pagamento criado para a API de confirmação do checkout:
   * `POST https://api.stripe.com/v1/payment_pages/{idSessao}/confirm`
   *
   * Trata `card_error` como resultado de sucesso da automação (o pagamento foi processado
   * mas o cartão foi recusado — comportamento esperado em testes).
   *
   * @param {string} idMetodoPagamento - ID do método de pagamento (pm_xxx) da etapa anterior
   * @returns {Promise<{sucesso: boolean, status: string, mensagem: string}>} Resultado da confirmação
   */
  async confirmarPagamento(idMetodoPagamento) {
    registrar('Confirmando pagamento via API...', 'info');

    const urlConfirmacao = `https://api.stripe.com/v1/payment_pages/${this.dadosStripe.idSessao}/confirm`;

    // Converte os cookies do browser para o formato de header HTTP
    const stringCookies = this.dadosStripe.cookies
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');

    const cabecalhos = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': this.dadosStripe.agenteUsuario,
      Origin: 'https://checkout.stripe.com',
      Referer: 'https://checkout.stripe.com/',
      Cookie: stringCookies,
    };

    /**
     * Monta o corpo da requisição de confirmação.
     * Aceita um idMetodo sobrescrito para usar nos retries com novo PM.
     */
    const montarParametros = (idMetodo) => {
      const p = new URLSearchParams();
      p.append('eid', 'NA');
      p.append('payment_method', idMetodo);
      p.append('expected_amount', '0');
      p.append('expected_payment_method_type', 'card');
      p.append('guid', this.dadosStripe.guid);
      p.append('muid', this.dadosStripe.muid);
      p.append('sid', this.dadosStripe.sid);
      p.append('key', this.dadosStripe.chavePublica);
      p.append('client_attribution_metadata[client_session_id]', this.dadosStripe.idSessaoCliente);
      p.append('client_attribution_metadata[checkout_session_id]', this.dadosStripe.idSessao);
      p.append('client_attribution_metadata[merchant_integration_source]', 'checkout');
      p.append('client_attribution_metadata[merchant_integration_version]', 'hosted_checkout');
      p.append('client_attribution_metadata[payment_method_selection_flow]', 'automatic');
      if (this.dadosStripe.idConfiguracaoCheckout) {
        p.append('client_attribution_metadata[checkout_config_id]', this.dadosStripe.idConfiguracaoCheckout);
      }
      return p;
    };

    /**
     * Interpreta a resposta do Stripe e devolve o resultado padronizado.
     * Retorna null quando a sessão está "open" e deve ser retentada.
     */
    const interpretarResposta = (resposta, dados) => {
      // HTTP 400 com "already been processed" = link já utilizado
      if (resposta.status === 400 && dados.error?.message?.includes('already been processed')) {
        registrar('Este link de checkout já foi utilizado anteriormente.', 'warning');
        return { sucesso: false, status: 'error', mensagem: 'Link de checkout já processado anteriormente.' };
      }

      if (dados.error) {
        registrar(`Resposta do Stripe: ${dados.error.message}`, 'warning');
        registrar(`Código do erro: ${dados.error.code || 'N/A'}`, 'warning');
        registrar(`Código de recusa: ${dados.error.decline_code || 'N/A'}`, 'warning');

        // card_error = automação funcionou, cartão recusado pelo emissor
        if (dados.error.type === 'card_error') {
          registrar('Automação concluída. Cartão recusado pelo emissor.', 'success');
          return { sucesso: true, status: 'card_declined', mensagem: dados.error.message };
        }

        return { sucesso: false, status: 'error', mensagem: dados.error.message };
      }

      const statusSessao = dados.status;
      registrar(`Status da sessão Stripe: ${statusSessao || 'N/A'}`, 'info');
      registrar(`Status do pagamento: ${dados.payment_status || 'N/A'}`, 'info');

      if (statusSessao === 'complete') {
        registrar('Pagamento confirmado com sucesso! Sessão concluída.', 'success');
        return { sucesso: true, status: 'paid', mensagem: 'Pagamento confirmado' };
      }

      if (statusSessao === 'open') {
        // Retorna null para sinalizar que deve ser retentado
        return null;
      }

      if (statusSessao === 'expired') {
        registrar('Link de checkout expirado.', 'error');
        return { sucesso: false, status: 'error', mensagem: 'Link de checkout expirado.' };
      }

      registrar(`Status desconhecido recebido: ${statusSessao}`, 'warning');
      return { sucesso: false, status: 'error', mensagem: `Status inesperado da sessão: ${statusSessao}` };
    };

    try {
      // Tentativa inicial
      const respostaInicial = await fetch(urlConfirmacao, {
        method: 'POST',
        headers: cabecalhos,
        body: montarParametros(idMetodoPagamento),
      });
      const dadosIniciais = await respostaInicial.json();
      const resultadoInicial = interpretarResposta(respostaInicial, dadosIniciais);

      if (resultadoInicial !== null) return resultadoInicial;

      // Sessão retornou "open" — pode ser condição de corrida pós-cupom.
      // Aguarda e retenta até 2 vezes com intervalo crescente (4s, 6s).
      const intervaloRetry = [4000, 6000];
      for (let tentativa = 1; tentativa <= intervaloRetry.length; tentativa++) {
        const espera = intervaloRetry[tentativa - 1];
        registrar(
          `Sessão ainda aberta (tentativa ${tentativa}/${intervaloRetry.length}). Aguardando ${espera / 1000}s antes de retentar...`,
          'warning',
        );
        await new Promise((res) => setTimeout(res, espera));

        const respostaRetry = await fetch(urlConfirmacao, {
          method: 'POST',
          headers: cabecalhos,
          body: montarParametros(idMetodoPagamento),
        });
        const dadosRetry = await respostaRetry.json();
        const resultadoRetry = interpretarResposta(respostaRetry, dadosRetry);

        if (resultadoRetry !== null) return resultadoRetry;
      }

      // Esgotou todas as tentativas — sessão permanece aberta
      registrar('Sessão permanece em aberto após todas as tentativas.', 'error');
      return { sucesso: false, status: 'error', mensagem: 'Pagamento não processado após múltiplas tentativas. Sessão permanece em aberto.' };

    } catch (erro) {
      registrar(`Falha na confirmação do pagamento: ${erro.message}`, 'error');
      return { sucesso: false, status: 'error', mensagem: erro.message };
    }
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
  }

  /**
   * Executa o fluxo completo de checkout em uma única chamada.
   *
   * Equivalente ao método `run()` do módulo original.
   * O browser é sempre fechado no final, mesmo em caso de erro.
   *
   * Ordem de execução:
   * 1. inicializar() — lança o Firefox headless
   * 2. extrairDadosSessao() — abre a URL e extrai tokens
   * 3. aplicarCupons(codigos) — aplica cupons via UI (se fornecidos)
   * 4. criarMetodoPagamento(dadosCartao, dadosEndereco) — cria pm_ via API
   * 5. confirmarPagamento(idMetodoPagamento) — confirma via API
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

      const idMetodoPagamento = await this.criarMetodoPagamento(cartao, endereco);
      const resultado = await this.confirmarPagamento(idMetodoPagamento);

      return resultado;
    } catch (erro) {
      registrar(`Erro fatal na execução: ${erro.message}`, 'error');
      return { sucesso: false, status: 'error', mensagem: erro.message };
    } finally {
      await this.fechar();
    }
  }
}
