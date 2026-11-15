import React from 'react';

const paths={
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  receipt:'M5 3l2 1 2-1 3 1 3-1 2 1 2-1v18l-2-1-2 1-3-1-3 1-2-1-2 1zM9 9h6m-6 4h6m-6 4h3',
  user:'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  bag:'M5 8h14l2 13H3zM9 10V6a3 3 0 0 1 6 0v4',
  menu:'M4 4h16v16H4zM8 8h8m-8 4h8m-8 4h5',
  time:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM12 6v6l4 2',
  store:'M3 10l2-6h14l2 6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 13v7h14v-7m-9 7v-5h4v5',
  delivery:'M4 7h10v10H4zM14 10h4l3 3v4h-7M9 18a2 2 0 1 1-4 0m15 0a2 2 0 1 1-4 0M1 11h3m-3 3h3',
  search:'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0zm-2 4 6 6',
  plus:'M12 5v14M5 12h14',
  arrow:'M4 12h15m-6-6 6 6-6 6',
  dish:'M3 16h18M5 15a7 7 0 0 1 14 0M12 5v2M4 19h16'
};
export function MenuIcon({name}:{name:keyof typeof paths}){
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]}/></svg>;
}
