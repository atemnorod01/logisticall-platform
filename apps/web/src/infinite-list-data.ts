export type InfinitePage<T>={items:T[];nextOffset:number|null};
export type InfiniteState<T>={items:T[];nextOffset:number|null;loading:boolean;error:string};
type Reader<T>=(offset:number,signal:AbortSignal)=>Promise<InfinitePage<T>>;

/** Keeps loaded rows in place, cancels stale searches, and serializes page reads. */
export class InfiniteListData<T>{
 private state:InfiniteState<T>={items:[],nextOffset:0,loading:false,error:''};
 private listeners=new Set<()=>void>();
 private controller:AbortController|undefined;
 private read?:Reader<T>;
 private failedOffset=0;
 private refreshPending=false;
 constructor(private id:(item:T)=>string){}
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(state:InfiniteState<T>){this.state=state;for(const listener of this.listeners)listener();}
 reset(read:Reader<T>){this.cancel();this.read=read;this.publish({items:[],nextOffset:0,loading:false,error:''});void this.fetch(0,false);}
 cancel(){this.controller?.abort();this.controller=undefined;this.refreshPending=false;}
 loadMore=()=>{if(!this.state.loading&&this.state.nextOffset!==null)void this.fetch(this.state.nextOffset,false);};
 retry=()=>{if(!this.state.loading)void this.fetch(this.failedOffset,this.failedOffset===0&&this.state.items.length>0);};
 refresh=()=>{if(this.state.loading)this.refreshPending=true;else void this.fetch(0,true);};
 private async fetch(offset:number,refresh:boolean){
  const read=this.read;if(!read)return;
  const controller=new AbortController();this.controller=controller;
  const before=this.state,target=refresh?before.items.length:0;
  this.failedOffset=offset;this.publish({...before,loading:true,error:''});
  try{
   let cursor:number|null=offset,items:T[]=offset?before.items:[];
   do{
    const page=await read(cursor!,controller.signal);
    if(controller.signal.aborted)return;
    if(page.nextOffset!==null&&page.nextOffset<=cursor!)throw Error('The list did not advance. Try again.');
    const known=new Set(items.map(this.id));
    if(page.nextOffset!==null&&!page.items.some(item=>!known.has(this.id(item))))throw Error('The list returned no new rows. Try again.');
    items=[...new Map([...items,...page.items].map(item=>[this.id(item),item])).values()];
    cursor=page.nextOffset;
   }while(refresh&&cursor!==null&&items.length<target);
   this.publish({items,nextOffset:cursor,loading:false,error:''});
  }catch(error){
   if(!controller.signal.aborted)this.publish({...before,loading:false,error:error instanceof Error?error.message:'Could not load the list.'});
  }finally{
   if(this.controller===controller){
    this.controller=undefined;
    if(this.refreshPending){this.refreshPending=false;void this.fetch(0,true);}
   }
  }
 }
}
