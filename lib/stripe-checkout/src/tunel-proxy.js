/**
 * tunel-proxy.js
 *
 * Cria um proxy HTTP CONNECT local que tunnela o tráfego através de um
 * proxy SOCKS5 autenticado. Necessário porque o Firefox (via Playwright)
 * não suporta autenticação SOCKS5 nativamente.
 *
 * Fluxo:
 *   Firefox → HTTP CONNECT → localhost:porta_local → SOCKS5 autenticado → destino
 *
 * Uso:
 *   const { iniciarTunelProxy, pararTunelProxy } = await import('./tunel-proxy.js')
 *   const porta = await iniciarTunelProxy('socks5://user:pass@host:port')
 *   // Usa proxy: { server: `http://localhost:${porta}` } no Playwright
 *   await pararTunelProxy(servidor)
 */

import http from 'http';
import net from 'net';
import { SocksClient } from 'socks';

/**
 * Analisa a string de proxy SOCKS5 autenticado.
 * @param {string} proxyStr - Formato: socks5://usuario:senha@host:porta ou host:porta:usuario:senha
 * @returns {{ host: string, porta: number, usuario: string, senha: string }}
 */
function analisarProxySocks5(proxyStr) {
  // Formato alternativo: host:porta:usuario:senha (vem do AutomacaoCheckout)
  // O construtor já montou this.proxy = { server: 'socks5://host:porta', username, password }
  // Então aqui recebemos o objeto já parseado
  throw new Error('Use analisarObjetoProxy em vez desta função');
}

/**
 * Inicia um servidor HTTP CONNECT local que tunnela via SOCKS5 autenticado.
 *
 * @param {{ server: string, username: string, password: string }} configProxy
 *   Configuração do proxy SOCKS5 (mesmo formato do Playwright)
 * @returns {Promise<{ servidor: http.Server, porta: number }>}
 */
export async function iniciarTunelProxy(configProxy) {
  // Extrai host e porta do server (ex: "socks5://gw.dataimpulse.com:10000")
  const urlProxy = new URL(configProxy.server);
  const hostProxy = urlProxy.hostname;
  const portaProxy = parseInt(urlProxy.port, 10);
  const usuario = configProxy.username;
  const senha = configProxy.password;

  const servidor = http.createServer();

  // Trata requisições HTTP CONNECT (usado pelo Firefox para HTTPS)
  servidor.on('connect', async (req, socketCliente, cabecalho) => {
    const [hostDestino, portaDestinoStr] = req.url.split(':');
    const portaDestino = parseInt(portaDestinoStr || '443', 10);

    try {
      const { socket: socketProxy } = await SocksClient.createConnection({
        proxy: {
          host: hostProxy,
          port: portaProxy,
          type: 5,
          userId: usuario,
          password: senha,
        },
        command: 'connect',
        destination: { host: hostDestino, port: portaDestino },
      });

      socketCliente.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socketProxy.pipe(socketCliente);
      socketCliente.pipe(socketProxy);

      socketProxy.on('error', () => socketCliente.destroy());
      socketCliente.on('error', () => socketProxy.destroy());
    } catch (erro) {
      socketCliente.write(`HTTP/1.1 502 Bad Gateway\r\n\r\n`);
      socketCliente.destroy();
    }
  });

  // Trata requisições HTTP comuns (não CONNECT)
  servidor.on('request', async (req, res) => {
    try {
      const urlDestino = new URL(req.url);
      const portaDestino = parseInt(urlDestino.port || '80', 10);

      const { socket: socketProxy } = await SocksClient.createConnection({
        proxy: { host: hostProxy, port: portaProxy, type: 5, userId: usuario, password: senha },
        command: 'connect',
        destination: { host: urlDestino.hostname, port: portaDestino },
      });

      const socketReq = net.connect({ host: urlDestino.hostname, port: portaDestino });
      req.pipe(socketReq);
      socketReq.pipe(res);
    } catch (erro) {
      res.writeHead(502);
      res.end();
    }
  });

  // Escolhe porta aleatória disponível
  await new Promise((resolve, reject) => {
    servidor.listen(0, '127.0.0.1', (erro) => {
      if (erro) reject(erro);
      else resolve();
    });
  });

  const porta = servidor.address().port;
  return { servidor, porta };
}

/**
 * Para e fecha o servidor de túnel local.
 * @param {http.Server} servidor
 */
export async function pararTunelProxy(servidor) {
  if (!servidor) return;
  await new Promise((resolve) => servidor.close(resolve));
}
