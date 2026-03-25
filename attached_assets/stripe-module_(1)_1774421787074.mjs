import { firefox } from 'playwright';
import fetch from 'node-fetch';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const log = (message, level = 'info') => {
    const prefix = level === 'error'
        ? '❌'
        : level === 'warning'
            ? '⚠️'
            : level === 'success'
                ? '✅'
                : '[*]';
    console.log(`${prefix} ${message}`);
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

function loadEnvFile() {
    try {
        const envPath = path.join(projectRoot, '.env');
        if (!fs.existsSync(envPath)) return {};
        const raw = fs.readFileSync(envPath, 'utf8');
        const lines = raw.split(/\r?\n/);
        const parsed = {};
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const idx = trimmed.indexOf('=');
            if (idx <= 0) continue;
            const key = trimmed.slice(0, idx).trim();
            let value = trimmed.slice(idx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            parsed[key] = value;
        }
        return parsed;
    } catch {
        return {};
    }
}

const envFromFile = loadEnvFile();
const getEnv = (key, fallback = '') => process.env[key] || envFromFile[key] || fallback;

const parseCodes = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return [];
    if (raw.startsWith('[')) {
        try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                return arr.map(item => String(item).trim()).filter(Boolean);
            }
        } catch {}
    }
    return raw.split(',').map(item => item.trim()).filter(Boolean);
};

// ============================================================================
// CONFIGURAÇÕES E DADOS
// ============================================================================

export const STRIPE_CODES = parseCodes(
    getEnv('STRIPE_CODES')
);

const CODES = STRIPE_CODES;


const CARD_DATA = {
    number: getEnv('STRIPE_CARD_NUMBER'),
    cvc: getEnv('STRIPE_CARD_CVC'),
    exp_month: getEnv('STRIPE_CARD_EXP_MONTH'),
    exp_year: getEnv('STRIPE_CARD_EXP_YEAR')
};

const BILLING_DATA = {
    name: getEnv('STRIPE_BILLING_NAME'),
    email: getEnv('STRIPE_BILLING_EMAIL'),
    country: getEnv('STRIPE_BILLING_COUNTRY'),
    line1: getEnv('STRIPE_BILLING_LINE1'),
    city: getEnv('STRIPE_BILLING_CITY'),
    state: getEnv('STRIPE_BILLING_STATE'),
    postal_code: getEnv('STRIPE_BILLING_POSTAL_CODE')
};

// ============================================================================
// FUNÇÕES AUXILIARES
// ============================================================================ 

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
            muid: '24F6C9D492896DCB0398DF62939D6C4A',
            sid: null,
            cookies: [],
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15',
            checkoutConfigId: null,
            clientSessionId: generateUUID()
        };
    }

    async init() {
        log('Inicializando navegador', 'info');
        
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

        log('Acessando Checkout...', 'info');
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
        } else {
            log('Não foi possível encontrar a chave pública no HTML. Tentando via API...', 'warning');
            const scripts = await this.page.$$eval('script', scripts => scripts.map(s => s.textContent));
            for (const script of scripts) {
                if (script) {
                    const match = script.match(/pk_live_[a-zA-Z0-9]+/);
                    if (match) {
                        this.stripeData.publicKey = match[0]; 
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
    }

    async applyCoupons() {
        log('Iniciando processo de aplicação de cupons...', 'info');
        
        // VERIFICAÇÃO INICIAL: Verificar se já há desconto aplicado
        const pageTextInitial = await this.page.content();
        if (pageTextInitial.includes('US$ 15,00') || pageTextInitial.includes('US$ 25,00') || 
            pageTextInitial.includes('desconto') || pageTextInitial.includes('discount') ||
            pageTextInitial.includes('-$')) {
            log('✅ Desconto já aplicado! Pulando etapa de cupons e seguindo para pagamento...', 'success');
            return true;
        }
        
        try {
            const promoButton = this.page.locator('[data-testid="product-summary-promo-code"]');
            if (await promoButton.isVisible({ timeout: 5000 })) { 
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
            
            if (pageText.includes('US$ 15,00') || pageText.includes('US$ 25,00') || 
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
                    log('A automação funcionou perfeitamente! O pagamento foi processado mas o cartão foi recusado', 'error');
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
    
    try {
        const automation = new StripeAutomation(checkoutUrl);
        const result = await automation.run();
        
        console.log(`${'='.repeat(100)}`);
        if (result && result.success) {
            console.log(` ✅ AUTOMAÇÃO STRIPE CONCLUÍDA COM SUCESSO`);
        } else {
            console.log(` ❌ FALHA NA AUTOMAÇÃO STRIPE`);
        }
        console.log(`${'='.repeat(100)}\n`);
        
        return result || { success: false, status: 'Erro desconhecido' };
    } catch (error) {
        console.error(`\n❌ ERRO FATAL NA AUTOMAÇÃO STRIPE: ${error.message}`);
        return { success: false, status: 'Erro fatal', error: error.message };
    }
}
