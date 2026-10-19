import {useState} from 'react';

export function usePagination<T>(items:readonly T[],resetKey='',initialPageSize=10) {
 const [size,setSize]=useState(initialPageSize);
 const [position,setPosition]=useState({page:0,key:resetKey});
 const pages=Math.max(1,Math.ceil(items.length/size));
 const page=position.key===resetKey?Math.min(position.page,pages-1):0;
 // Keep the stored page valid when filtering or background updates remove rows.
 if(position.key!==resetKey||position.page!==page)setPosition({page,key:resetKey});
 const setPage=(value:number)=>setPosition({page:Math.max(0,value),key:resetKey});
 const setPageSize=(value:number)=>{setSize(value);setPosition({page:0,key:resetKey});};
 return {items:items.slice(page*size,(page+1)*size),total:items.length,page,pageSize:size,pages,setPage,setPageSize};
}
