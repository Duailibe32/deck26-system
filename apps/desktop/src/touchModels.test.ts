import {describe,it,expect} from 'vitest';
import {touchDigits,formatTouchMoney,productSeal} from './touchModels.js';
import {parseMoney,splitCents,roleHome,visibleModules,canChooseView} from './desktopModels.js';

describe('Entrada touch e identificação de produtos',()=>{
  it('abre cada função na operação correspondente e restringe a alternância gerencial',()=>{
    expect(roleHome('WAITER')).toBe('mesas-comandas');expect(roleHome('KITCHEN')).toBe('cozinha');
    expect(roleHome('RECEPTIONIST')).toBe('hotel-reservas');expect(roleHome('CASHIER')).toBe('caixa-pdv');
    expect(canChooseView('WAITER')).toBe(false);expect(canChooseView('OWNER')).toBe(true);
    expect(visibleModules('WAITER','COMPLETE').some(module=>['financeiro','auditoria'].includes(module.id))).toBe(false);
    expect(visibleModules('OWNER','COMPLETE').some(module=>module.id==='auditoria')).toBe(true);
  });
  it('substitui o saldo inicial e digita centavos sem arredondar dinheiro',()=>{
    let digits=touchDigits('12765','1',true);
    for(const key of ['0','0','0']) digits=touchDigits(digits,key);
    expect(formatTouchMoney(digits)).toBe('10,00');
    expect(parseMoney(formatTouchMoney(digits))).toBe(1000);
    expect(formatTouchMoney(touchDigits(digits,'00'))).toBe('1000,00');
  });
  it('limpa, apaga, aceita zero e limita valor e quantidade sem truncar',()=>{
    expect(touchDigits('1000','BACKSPACE')).toBe('100');
    expect(touchDigits('1000','CLEAR')).toBe('');
    expect(touchDigits('','00')).toBe('0');
    expect(touchDigits('999999999','1')).toBe('999999999');
    expect(touchDigits('9','00',false,2)).toBe('9');
    expect(touchDigits('','2',true,2)).toBe('2');
    expect(touchDigits('20','-')).toBe('20');
  });
  it('mantém os centavos na divisão e calcula troco exato',()=>{
    const parts=splitCents(10000,3);
    expect(parts).toEqual([3334,3333,3333]);
    expect(parts.reduce((sum,value)=>sum+value,0)).toBe(10000);
    expect(parseMoney('100,00')!-parseMoney('36,75')!).toBe(6325);
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('10,001')).toBe(null);
  });
  it.each([
    ['Cuscuz Carne de Sol','Cuscuz & Tapiocas','corn'],
    ['Picanha Executiva','Pratos Executivos','grill'],
    ['Pastel de Carne','Petiscos & Pastéis','snack'],
    ['Suco de Acerola 300ml','Sucos & Vitaminas','fruit'],
    ['Café com Leite','Cafeteria','coffee'],
    ['Água Mineral','Bebidas','other']
  ])('classifica %s sem confundir seu ingrediente com a categoria',(name,category,tone)=>{
    const seal=productSeal({name,categoryId:'cat-01',prepStation:'KITCHEN_HOT'},category);
    expect(seal.tone).toBe(tone);expect(seal.label.length).toBeGreaterThan(0);expect(seal.icon.length).toBeGreaterThan(0);
  });
});
