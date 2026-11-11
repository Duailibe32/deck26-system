import React from 'react';

const groups = [
  {id:'all',label:'Todo o cardápio',categories:[]},
  {id:'drinks',label:'Bebidas',categories:['cat-cafeteria','cat-sucos','cat-vitaminas']},
  {id:'starters',label:'Entradas',categories:['cat-petiscos','cat-pasteis']},
  {id:'mains',label:'Pratos principais',categories:['cat-executivos','cat-tapioca','cat-qualquer-hora','cat-cuscuz','cat-lanches']}
] as const;
export type MenuGroup = typeof groups[number]['id'];

export function matchesMenuGroup(categoryId:string,group:MenuGroup) {
  if(group==='all')return true;
  return groups.some(item=>item.id===group&&item.categories.some(id=>id===categoryId));
}

export function normalizeMenuSearch(value:string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();
}

export function MenuCategoryFilter({value,onChange,categoryIds}:{
  value:MenuGroup;onChange:(value:MenuGroup)=>void;categoryIds:ReadonlySet<string>;
}) {
  return <nav className="d26-menu-group-filter" aria-label="Grupos do cardápio">
    {groups.filter(group=>group.id==='all'||group.categories.some(id=>categoryIds.has(id))).map(group=>
      <button key={group.id} type="button" aria-pressed={value===group.id} onClick={()=>onChange(group.id)}>{group.label}</button>)}
  </nav>;
}
