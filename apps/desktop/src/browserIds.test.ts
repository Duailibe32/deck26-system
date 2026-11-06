import {expect,it} from 'vitest';import {randomBrowserId} from './browserIds.js';
it('gera identificadores seguros no celular via HTTP sem depender de randomUUID',()=>{
 const insecureContextCrypto={getRandomValues:crypto.getRandomValues.bind(crypto)};
 const first=randomBrowserId(insecureContextCrypto),second=randomBrowserId(insecureContextCrypto);
 expect(first).toMatch(/^[a-f0-9]{32}$/);expect(second).toMatch(/^[a-f0-9]{32}$/);expect(first).not.toBe(second);
});
