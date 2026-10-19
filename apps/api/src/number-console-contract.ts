/** Exact UI capabilities, not an open proxy. Keep in sync with the legacy bridge. */
export function numberConsolePath(method:string,path:string){
 const [pathname,query='']=path.split('?');
 if(!pathname||path.includes('\\')||/%(?:2f|5c|2e)/i.test(path)||path.includes('#'))return false;
 const id='[a-zA-Z0-9_-]{1,100}';
 const read=[/^\/telephone-numbers$/, /^\/number-purchase\/(context|assignments|routing|orders|releases|order-directory|notifications)$/,new RegExp('^/number-purchase/(orders|releases)/'+id+'$'),/^\/number-purchase\/coverage\/(countries|regions|localities|areacodes)$/, /^\/routing\/(bootstrap|health)$/];
 const write=[/^\/telephone-numbers\/sync$/, /^\/number-purchase\/(search|orders|assignments|releases)$/,new RegExp('^/number-purchase/assignments/(?:assign|unassign|'+id+'/unassign)$'),new RegExp('^/number-purchase/orders/'+id+'/resume$'),new RegExp('^/number-purchase/releases/'+id+'/check$'),/^\/routing\/did-apply$/];
 if(!(method==='GET'?read:method==='POST'?write:[]).some(r=>r.test(pathname)))return false;
 const allowed=pathname.endsWith('/order-directory')?['limit','offset','sort','direction']:pathname.includes('/coverage/')?['accountId','country','region','force']:pathname.endsWith('/context')?['accountId']:pathname.endsWith('/routing')?['organizationId']:pathname.endsWith('/orders')?['inventory']:[];
 const params=new URLSearchParams(query);
 return path.length<2048&&[...params.keys()].every(k=>allowed.includes(k)&&params.getAll(k).length===1);
}
