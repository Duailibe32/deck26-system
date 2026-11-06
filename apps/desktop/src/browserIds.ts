/** getRandomValues also works on HTTP over a trusted local LAN; randomUUID requires HTTPS. */
export function randomBrowserId(source:Pick<Crypto,'getRandomValues'>=crypto):string {
 return Array.from(source.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
}
