/** ViaCEP is an optional aid. Only the eight CEP digits leave the local server. */
export async function lookupCep(cep: string, fetcher: typeof fetch = fetch) {
  if (!/^\d{8}$/.test(cep)) throw Error('Informe um CEP com oito dígitos.');
  const response = await fetcher('https://viacep.com.br/ws/' + cep + '/json/', {
    signal: AbortSignal.timeout(4000),
    redirect: 'error'
  });
  if (!response.ok) throw Error('Consulta indisponível. Preencha o endereço manualmente.');
  const value = (await response.json()) as Record<string, unknown>;
  if (value.erro) return null;
  const text = (key: string) => typeof value[key] === 'string' ? String(value[key]).trim().slice(0, 150) : '';
  return {
    street: text('logradouro'),
    neighborhood: text('bairro'),
    city: text('localidade'),
    state: text('uf')
  };
}
