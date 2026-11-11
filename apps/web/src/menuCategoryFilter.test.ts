import {describe,expect,it} from 'vitest';
import {DECK26_STAGE7A_CATEGORIES} from '@deck26/contracts';
import {matchesMenuGroup,normalizeMenuSearch,type MenuGroup} from '@deck26/ui';

describe('Filtro do cardápio',()=>{
  it('classifica as dez categorias oficiais em três grupos sem sobreposição',()=>{
    const groups:MenuGroup[]=['drinks','starters','mains'];
    for(const category of DECK26_STAGE7A_CATEGORIES){
      expect(groups.filter(group=>matchesMenuGroup(category.id,group))).toHaveLength(1);
    }
    expect(matchesMenuGroup('cat-sucos','drinks')).toBe(true);
    expect(matchesMenuGroup('cat-petiscos','starters')).toBe(true);
    expect(matchesMenuGroup('cat-executivos','mains')).toBe(true);
    expect(matchesMenuGroup('cat-personalizada','all')).toBe(true);
    expect(normalizeMenuSearch('  CAFÉ com Leite  ')).toBe('cafe com leite');
  });
});
