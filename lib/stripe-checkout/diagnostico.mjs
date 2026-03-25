/**
 * diagnostico.mjs
 * 
 * Script de diagnóstico completo para o módulo @workspace/stripe-checkout.
 * Loga cada etapa em detalhe e exibe os campos críticos da resposta do Stripe.
 * 
 * Uso: cd lib/stripe-checkout && node diagnostico.mjs
 * Substitua LINK_CHECKOUT abaixo por um link fresco (não utilizado anteriormente).
 */

import { firefox } from 'playwright';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';

// ── CONFIGURAÇÃO ─────────────────────────────────────────────────
const LINK_CHECKOUT = 'SUBSTITUA_PELO_LINK'

const CARTAO = { numero: '5226269772380877', cvv: '922', mesVencimento: '03', anoVencimento: '34' }
const ENDERECO = {
  nome: 'Joao PIRES SILVA', email: 'joaodeprelian@gmail.com',
  pais: 'BR', rua: 'Rua Assef Buainain', cidade: 'Campo Grande', estado: 'MS', cep: '79042-470'
}
const CODIGOS_CUPOM = ['SYMPOSIUMPC20']
// ─────────────────────────────────────────────────────────────────

const D = {
  idSessao: null, chavePublica: null, guid: null, muid: null, sid: null,
  cookies: [], idConfiguracaoCheckout: null, idSessaoCliente: randomUUID(),
  agenteUsuario: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
}

console.log('\n' + '═'.repeat(80))
console.log(' DIAGNÓSTICO STRIPE-CHECKOUT')
console.log('═'.repeat(80))
console.log(' Link:', LINK_CHECKOUT.substring(0, 80) + '...')

// ── ETAPA 1: BROWSER ─────────────────────────────────────────────
console.log('\n── ETAPA 1: INICIALIZANDO FIREFOX ──')
const browser = await firefox.launch({
  headless: true, args: ['--no-sandbox'],
  firefoxUserPrefs: {
    'dom.webdriver.enabled': false, 'privacy.resistFingerprinting': true,
    'browser.cache.disk.enable': false, 'network.http.use-cache': false
  }
})
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 }, userAgent: D.agenteUsuario,
  locale: 'pt-BR', timezoneId: 'America/Sao_Paulo'
})
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
  Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] })
})
const page = await ctx.newPage()
console.log('Firefox iniciado.')

// ── ETAPA 2: EXTRAIR SESSÃO ───────────────────────────────────────
console.log('\n── ETAPA 2: EXTRAINDO SESSÃO ──')
D.idSessao = LINK_CHECKOUT.split('/pay/')[1].split('#')[0].split('?')[0]
console.log('Session ID:', D.idSessao)

await page.goto(LINK_CHECKOUT, { waitUntil: 'domcontentloaded', timeout: 90000 })
console.log('Aguardando Stripe.js carregar (8s)...')
await page.waitForTimeout(8000)

const html = await page.content()
const km = html.match(/pk_live_[a-zA-Z0-9]+/)
if (km) {
  D.chavePublica = km[0]
  console.log('Chave pública (HTML):', D.chavePublica.substring(0, 20) + '...')
} else {
  const scripts = await page.$$eval('script', els => els.map(s => s.textContent))
  for (const s of scripts) {
    const m = s?.match(/pk_live_[a-zA-Z0-9]+/)
    if (m) { D.chavePublica = m[0]; console.log('Chave pública (script):', D.chavePublica.substring(0, 20) + '...'); break }
  }
}
if (!D.chavePublica) { console.log('CRÍTICO: chave pública não encontrada!'); await browser.close(); process.exit(1) }

D.cookies = await ctx.cookies()
console.log('Cookies:', D.cookies.map(c => c.name).join(', '))

// Extrai muid e sid dos cookies Stripe (__stripe_mid / __stripe_sid)
const cookieMid = D.cookies.find(c => c.name === '__stripe_mid')
const cookieSid = D.cookies.find(c => c.name === '__stripe_sid')
if (cookieMid) {
  D.muid = cookieMid.value
  console.log('MUID (__stripe_mid):', D.muid.substring(0, 8) + '... ✓ capturado do cookie')
}
if (cookieSid) {
  D.sid = cookieSid.value
  console.log('SID  (__stripe_sid):', D.sid.substring(0, 8) + '... ✓ capturado do cookie')
}

// Tenta extrair guid do localStorage
if (!D.guid) {
  try {
    const guidLocal = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && (k.includes('guid') || k.includes('gr_guid'))) return localStorage.getItem(k)
      }
      return null
    })
    if (guidLocal) {
      D.guid = guidLocal
      console.log('GUID (localStorage):', D.guid.substring(0, 8) + '... ✓ capturado do localStorage')
    }
  } catch (_) {}
}
if (!D.guid) { D.guid = randomUUID(); console.log('GUID (gerado):', D.guid.substring(0, 8) + '... ← UUID aleatório') }
if (!D.muid) { D.muid = randomUUID(); console.log('MUID (gerado):', D.muid.substring(0, 8) + '... ← UUID aleatório') }
if (!D.sid) { D.sid = randomUUID(); console.log('SID  (gerado):', D.sid.substring(0, 8) + '... ← UUID aleatório') }

// ── ETAPA 3: CUPOM ────────────────────────────────────────────────
console.log('\n── ETAPA 3: CUPOM ──')
const htmlPagina = await page.content()
const descontoExistente = htmlPagina.includes('discount') || htmlPagina.includes('desconto') || htmlPagina.includes('-$')
console.log('Desconto já presente:', descontoExistente)

if (!descontoExistente) {
  for (const codigo of CODIGOS_CUPOM) {
    try {
      const botao = page.locator('[data-testid="product-summary-promo-code"]')
      if (await botao.isVisible({ timeout: 3000 })) { await botao.click(); await page.waitForTimeout(1000) }
    } catch (_) {}
    const campo = page.getByRole('textbox', { name: /Adicionar código promocional|Add promotion code/i })
    try {
      await campo.waitFor({ state: 'visible', timeout: 8000 })
      await campo.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace')
      await page.waitForTimeout(400); await campo.fill(codigo); await page.waitForTimeout(400)
      await page.keyboard.press('Enter'); await page.waitForTimeout(4000)
      const txt = await page.content()
      const aplicado = txt.includes('discount') || txt.includes('desconto') || txt.includes('-$') || txt.includes('US$ 5') || txt.includes('US$ 15')
      const invalido = txt.includes('Código inválido') || txt.includes('Invalid promotion code')
      console.log(`Cupom ${codigo}: aplicado=${aplicado}, inválido=${invalido}`)
      if (aplicado) break
    } catch (e) { console.log('Campo de cupom não encontrado:', e.message) }
  }
}

await browser.close()
console.log('Browser fechado.')

// ── ETAPA 4: CRIAR PAYMENT METHOD ────────────────────────────────
console.log('\n── ETAPA 4: CRIAR PAYMENT METHOD ──')
const pmP = new URLSearchParams()
pmP.append('type', 'card'); pmP.append('card[number]', CARTAO.numero)
pmP.append('card[cvc]', CARTAO.cvv); pmP.append('card[exp_month]', CARTAO.mesVencimento); pmP.append('card[exp_year]', CARTAO.anoVencimento)
pmP.append('billing_details[name]', ENDERECO.nome); pmP.append('billing_details[email]', ENDERECO.email)
pmP.append('billing_details[address][country]', ENDERECO.pais); pmP.append('billing_details[address][line1]', ENDERECO.rua)
pmP.append('billing_details[address][city]', ENDERECO.cidade); pmP.append('billing_details[address][state]', ENDERECO.estado)
pmP.append('billing_details[address][postal_code]', ENDERECO.cep)
pmP.append('key', D.chavePublica); pmP.append('guid', D.guid); pmP.append('muid', D.muid); pmP.append('sid', D.sid)
pmP.append('payment_user_agent', 'stripe.js/ceeb51e570; stripe-js-v3/ceeb51e570')

const pmR = await fetch('https://api.stripe.com/v1/payment_methods', {
  method: 'POST', body: pmP,
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json',
    'User-Agent': D.agenteUsuario, 'Origin': 'https://checkout.stripe.com', 'Referer': 'https://checkout.stripe.com/'
  }
})
const pmD = await pmR.json()
console.log('HTTP Status:', pmR.status)
if (pmD.error) { console.log('ERRO PM:', pmD.error.message); await process.exit(1) }
console.log('PM ID:', pmD.id, '| brand:', pmD.card?.brand, '| last4:', pmD.card?.last4)

// ── ETAPA 5: CONFIRMAR ────────────────────────────────────────────
console.log('\n── ETAPA 5: CONFIRMAR PAGAMENTO ──')
const cP = new URLSearchParams()
cP.append('eid', 'NA'); cP.append('payment_method', pmD.id)
cP.append('expected_amount', '0'); cP.append('expected_payment_method_type', 'card')
cP.append('guid', D.guid); cP.append('muid', D.muid); cP.append('sid', D.sid); cP.append('key', D.chavePublica)
cP.append('client_attribution_metadata[client_session_id]', D.idSessaoCliente)
cP.append('client_attribution_metadata[checkout_session_id]', D.idSessao)
cP.append('client_attribution_metadata[merchant_integration_source]', 'checkout')
cP.append('client_attribution_metadata[merchant_integration_version]', 'hosted_checkout')
cP.append('client_attribution_metadata[payment_method_selection_flow]', 'automatic')
if (D.idConfiguracaoCheckout) cP.append('client_attribution_metadata[checkout_config_id]', D.idConfiguracaoCheckout)

const cookieStr = D.cookies.map(c => `${c.name}=${c.value}`).join('; ')
const cR = await fetch(`https://api.stripe.com/v1/payment_pages/${D.idSessao}/confirm`, {
  method: 'POST', body: cP,
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json',
    'User-Agent': D.agenteUsuario, 'Origin': 'https://checkout.stripe.com',
    'Referer': 'https://checkout.stripe.com/', 'Cookie': cookieStr
  }
})
const cD = await cR.json()

console.log('\n── RESULTADO FINAL ──')
console.log('HTTP Status confirm:', cR.status)
console.log('Erro:', cD.error?.message || 'nenhum')
console.log('Session status:', cD.status || 'N/A')
console.log('Payment status:', cD.payment_status || 'N/A')
console.log('Session ID (resposta):', cD.id || 'N/A')
console.log('Total due:', cD.total_summary?.due, '| total:', cD.total_summary?.total)
console.log('\n' + '═'.repeat(80))
if (cR.status === 200 && cD.status === 'complete') {
  console.log(' ✅ PAGAMENTO PROCESSADO COM SUCESSO (status: complete)')
} else if (cD.status === 'open') {
  console.log(' ⚠️  SESSÃO AINDA ABERTA — pagamento não processado (status: open)')
} else if (cR.status === 400 && cD.error?.message?.includes('already been processed')) {
  console.log(' ℹ️  LINK JÁ PROCESSADO ANTERIORMENTE')
} else if (cD.error?.type === 'card_error') {
  console.log(' ⚠️  CARTÃO RECUSADO:', cD.error.message, '| decline_code:', cD.error.decline_code)
} else {
  console.log(' ❌ RESULTADO INESPERADO — veja os logs acima')
}
console.log('═'.repeat(80))
