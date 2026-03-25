import { firefox } from 'playwright';
import fetch from 'node-fetch';
import crypto from 'crypto';

// ============================================================================
// CONFIGURAÇÕES E DADOS
// ============================================================================

const CODES = [
    'COMM-MARC-8314'
];


const CARD_DATA = {
    number: '5226 2612 0029 3012',
    cvc: '237',
    exp_month: '03',
    exp_year: '34'
};

const BILLING_DATA = {
    name: 'JAIRO PIRES SILVA',
    email: 'pel.odeprelian@proton.me',
    country: 'BR',
    line1: 'Rua Assef Buainain',
    city: 'Campo Grande',
    state: 'MS',
    postal_code: '79042-470'
};

// ============================================================================
// FUNÇÕES AUXILIARES
// ============================================================================

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const normalizedType = ['info', 'warning', 'error', 'success'].includes(type) ? type : 'info';
    console.log(`    [${timestamp}] [stripe] [${normalizedType}] ${message}`);
}

function generateUUID() {
    return crypto.randomUUID();
}

// ============================================================================
// CLASSE PRINCIPAL DE AUTOMAÇÃO
// ============================================================================

export class StripeAutomation {
    constructor(checkoutUrl) {
        this.checkoutUrl = checkoutUrl;
        this.browser = null;
        this.context = null;
        this.page = null;
        
        this.stripeData = {
            sessionId: null,
            publicKey: null,
            guid: null,
            muid: null,
            sid: null,
            cookies: [],
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
            checkoutConfigId: null,
            clientSessionId: generateUUID()
        };
    }

    async init() {
        log('Inicializando navegador Firefox com evasão de detecção...', 'info');
        
        this.browser = await firefox.launch({
            headless: true,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ],
            firefoxUserPrefs: {
                'dom.webdriver.enabled': false,
                'privacy.resistFingerprinting': true,
                'privacy.trackingprotection.enabled': true,
                'browser.cache.disk.enable': false,
                'browser.cache.memory.enable': false,
                'network.http.use-cache': false
            }
        });

        this.context = await this.browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: this.stripeData.userAgent,
            locale: 'pt-BR',
            timezoneId: 'America/Sao_Paulo',
            hasTouch: false,
            isMobile: false,
            javaScriptEnabled: true
        });

        await this.context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
        });

        this.page = await this.context.newPage();
        
        this.page.on('request', request => {
            const url = request.url();
            if (url.includes('api.stripe.com') || url.includes('r.stripe.com')) {
                const postData = request.postData();
                if (postData) {
                    try {
                        const params = new URLSearchParams(postData);
                        if (params.has('guid')) this.stripeData.guid = params.get('guid');
                        if (params.has('muid')) this.stripeData.muid = params.get('muid');
                        if (params.has('sid')) this.stripeData.sid = params.get('sid');
                        
                        if (params.has('events')) {
                            const events = JSON.parse(params.get('events'));
                            if (events && events.length > 0 && events[0].checkout_config_id) {
                                this.stripeData.checkoutConfigId = events[0].checkout_config_id;
                            }
                        }
                    } catch (e) {}
                }
            }
        });
    }

    async extractSessionData() {
        log('Extraindo dados da sessão...', 'info');
        
        try {
            const urlParts = this.checkoutUrl.split('/pay/');
            if (urlParts.length > 1) {
                this.stripeData.sessionId = urlParts[1].split('#')[0].split('?')[0];
                log(`Session ID extraído: ${this.stripeData.sessionId}`, 'success');
            } else {
                throw new Error('Formato de URL inválido. Não foi possível extrair o Session ID.');
            }
        } catch (error) {
            log(`Erro ao extrair Session ID: ${error.message}`, 'error');
            throw error;
        }

        log('Acessando página de checkout...', 'info');
        await this.page.goto(this.checkoutUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 90000 
        });

        await this.page.waitForTimeout(5000);

        log('Buscando chave pública do Stripe...', 'info');
        const html = await this.page.content();
        const keyMatch = html.match(/pk_live_[a-zA-Z0-9]+/);
        
        if (keyMatch) {
            this.stripeData.publicKey = keyMatch[0];
            log(`Chave pública extraída: ${this.stripeData.publicKey.substring(0, 15)}...`, 'success');
        } else {
            log('Não foi possível encontrar a chave pública no HTML. Tentando via API...', 'warning');
            const scripts = await this.page.$$eval('script', scripts => scripts.map(s => s.textContent));
            for (const script of scripts) {
                if (script) {
                    const match = script.match(/pk_live_[a-zA-Z0-9]+/);
                    if (match) {
                        this.stripeData.publicKey = match[0];
                        log(`Chave pública extraída de script: ${this.stripeData.publicKey.substring(0, 15)}...`, 'success');
                        break;
                    }
                }
            }
        }

        if (!this.stripeData.publicKey) {
            throw new Error('Chave pública do Stripe não encontrada.');
        }

        const cookies = await this.context.cookies();
        this.stripeData.cookies = cookies;
        
        if (!this.stripeData.guid) this.stripeData.guid = generateUUID();
        if (!this.stripeData.muid) this.stripeData.muid = generateUUID();
        if (!this.stripeData.sid) this.stripeData.sid = generateUUID();
        
        log(`IDs de rastreamento: GUID=${this.stripeData.guid.substring(0,8)}..., MUID=${this.stripeData.muid.substring(0,8)}...`, 'info');
    }

    async applyCoupons() {
        log('Iniciando processo de aplicação de cupons...', 'info');
        
        // VERIFICAÇÃO INICIAL: Verificar se já há desconto aplicado
        const pageTextInitial = await this.page.content();
        if (pageTextInitial.includes('US$ 5,00') || pageTextInitial.includes('US$ 15,00') || 
            pageTextInitial.includes('desconto') || pageTextInitial.includes('discount') ||
            pageTextInitial.includes('-$')) {
            log('✅ Desconto já aplicado! Pulando etapa de cupons e seguindo para pagamento...', 'success');
            return true;
        }
        
        try {
            const promoButton = this.page.locator('[data-testid="product-summary-promo-code"]');
            if (await promoButton.isVisible({ timeout: 5000 })) {
                log('Botão de código promocional encontrado. Clicando...', 'info');
                await promoButton.click();
                await this.page.waitForTimeout(1000);
            }
        } catch (e) {
            log('Botão de código promocional não encontrado ou já expandido.', 'info');
        }

        const promoInput = this.page.getByRole('textbox', { name: /Adicionar código promocional|Add promotion code/i });
        
        try {
            await promoInput.waitFor({ state: 'visible', timeout: 10000 });
        } catch (e) {
            log('Campo de código promocional não encontrado. A página pode não aceitar cupons.', 'warning');
            return false;
        }

        let couponApplied = false;

        for (const code of CODES) {
            log(`Testando cupom: ${code}`, 'info');
            
            await promoInput.click();
            await this.page.keyboard.press('Control+A');
            await this.page.keyboard.press('Backspace');
            await this.page.waitForTimeout(500);
            
            await promoInput.fill(code);
            await this.page.waitForTimeout(500);
            await this.page.keyboard.press('Enter');
            
            log('Aguardando validação...', 'info');
            await this.page.waitForTimeout(3000);
            
            const pageText = await this.page.content();
            
            if (pageText.includes('Código inválido') || pageText.includes('Invalid promotion code')) {
                log(`Cupom ${code} é INVÁLIDO.`, 'warning');
                continue;
            }
            
            if (pageText.includes('US$ 5,00') || pageText.includes('US$ 15,00') || 
                pageText.includes('desconto') || pageText.includes('discount') ||
                pageText.includes('-$')) {
                log(`Cupom ${code} APLICADO COM SUCESSO!`, 'success');
                couponApplied = true;
                break;
            }
            
            const errorVisible = await this.page.locator('text=/Código inválido|Invalid promotion code/i').isVisible().catch(() => false);
            if (!errorVisible) {
                log(`Cupom ${code} parece ter sido aceito (sem mensagem de erro).`, 'success');
                couponApplied = true;
                break;
            }
        }

        if (!couponApplied) {
            log('Nenhum cupom válido encontrado.', 'warning');
        }

        return couponApplied;
    }

    async createPaymentMethod() {
        log('Criando método de pagamento via API...', 'info');
        
        const url = 'https://api.stripe.com/v1/payment_methods';
        
        const params = new URLSearchParams();
        params.append('type', 'card');
        params.append('card[number]', CARD_DATA.number);
        params.append('card[cvc]', CARD_DATA.cvc);
        params.append('card[exp_month]', CARD_DATA.exp_month);
        params.append('card[exp_year]', CARD_DATA.exp_year);
        params.append('billing_details[name]', BILLING_DATA.name);
        params.append('billing_details[email]', BILLING_DATA.email);
        params.append('billing_details[address][country]', BILLING_DATA.country);
        params.append('billing_details[address][line1]', BILLING_DATA.line1);
        params.append('billing_details[address][city]', BILLING_DATA.city);
        params.append('billing_details[address][state]', BILLING_DATA.state);
        params.append('billing_details[address][postal_code]', BILLING_DATA.postal_code);
        params.append('key', this.stripeData.publicKey);
        params.append('guid', this.stripeData.guid);
        params.append('muid', this.stripeData.muid);
        params.append('sid', this.stripeData.sid);
        params.append('payment_user_agent', 'stripe.js/ceeb51e570; stripe-js-v3/ceeb51e570');

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'User-Agent': this.stripeData.userAgent,
                    'Origin': 'https://checkout.stripe.com',
                    'Referer': 'https://checkout.stripe.com/'
                },
                body: params
            });

            const data = await response.json();
            
            if (data.error) {
                throw new Error(`Erro ao criar método de pagamento: ${data.error.message}`);
            }
            
            log(`Método de pagamento criado com sucesso: ${data.id}`, 'success');
            return data.id;
            
        } catch (error) {
            log(`Falha na criação do método de pagamento: ${error.message}`, 'error');
            throw error;
        }
    }

    async confirmPayment(paymentMethodId) {
        log('Confirmando pagamento via API...', 'info');
        
        const url = `https://api.stripe.com/v1/payment_pages/${this.stripeData.sessionId}/confirm`;
        
        const cookieString = this.stripeData.cookies
            .map(c => `${c.name}=${c.value}`)
            .join('; ');
        
        const params = new URLSearchParams();
        params.append('eid', 'NA');
        params.append('payment_method', paymentMethodId);
        params.append('expected_amount', '0');
        params.append('expected_payment_method_type', 'card');
        params.append('guid', this.stripeData.guid);
        params.append('muid', this.stripeData.muid);
        params.append('sid', this.stripeData.sid);
        params.append('key', this.stripeData.publicKey);
        
        params.append('client_attribution_metadata[client_session_id]', this.stripeData.clientSessionId);
        params.append('client_attribution_metadata[checkout_session_id]', this.stripeData.sessionId);
        params.append('client_attribution_metadata[merchant_integration_source]', 'checkout');
        params.append('client_attribution_metadata[merchant_integration_version]', 'hosted_checkout');
        params.append('client_attribution_metadata[payment_method_selection_flow]', 'automatic');
        
        if (this.stripeData.checkoutConfigId) {
            params.append('client_attribution_metadata[checkout_config_id]', this.stripeData.checkoutConfigId);
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'User-Agent': this.stripeData.userAgent,
                    'Origin': 'https://checkout.stripe.com',
                    'Referer': 'https://checkout.stripe.com/',
                    'Cookie': cookieString
                },
                body: params
            });

            const data = await response.json();
            
            if (data.error) {
                log(`Resposta do Stripe (Erro esperado de cartão): ${data.error.message}`, 'warning');
                log(`Código do erro: ${data.error.code || 'N/A'}`, 'warning');
                log(`Decline code: ${data.error.decline_code || 'N/A'}`, 'warning');
                
                if (data.error.type === 'card_error') {
                    log('A automação funcionou perfeitamente! O pagamento foi processado mas o cartão foi recusado (como esperado).', 'success');
                    return { success: true, status: 'card_declined', message: data.error.message };
                }
                
                return { success: false, status: 'error', message: data.error.message };
            }
            
            log('Pagamento confirmado com sucesso!', 'success');
            log(`Status: ${data.status || 'N/A'}`, 'success');
            return { success: true, status: data.status, message: 'Pagamento confirmado' };
            
        } catch (error) {
            log(`Falha na confirmação do pagamento: ${error.message}`, 'error');
            return { success: false, status: 'error', message: error.message };
        }
    }

    async run() {
        try {
            await this.init();
            await this.extractSessionData();
            await this.applyCoupons();
            
            const paymentMethodId = await this.createPaymentMethod();
            const result = await this.confirmPayment(paymentMethodId);
            
            return result;
        } catch (error) {
            log(`Erro fatal na execução: ${error.message}`, 'error');
            return { success: false, status: 'fatal_error', message: error.message };
        } finally {
            if (this.browser) {
                log('Fechando navegador...', 'info');
                await this.browser.close();
            }
        }
    }
}

// Função helper para ser chamada de outros scripts
export async function processStripePayment(checkoutUrl) {
    console.log(`\n${'='.repeat(100)}`);
    console.log(` INICIANDO AUTOMAÇÃO DE PAGAMENTO STRIPE`);
    console.log(`${'='.repeat(100)}`);
    console.log(` URL: ${checkoutUrl}`);
    
    const automation = new StripeAutomation(checkoutUrl);
    const result = await automation.run();
    
    console.log(`${'='.repeat(100)}`);
    if (result.success) {
        console.log(` ✅ AUTOMAÇÃO STRIPE CONCLUÍDA COM SUCESSO`);
    } else {
        console.log(` ❌ FALHA NA AUTOMAÇÃO STRIPE`);
    }
    console.log(`${'='.repeat(100)}\n`);
    
    return result;
}
