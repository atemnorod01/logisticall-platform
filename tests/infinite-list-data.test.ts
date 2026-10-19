import {expect,it,vi} from 'vitest';
import {InfiniteListData,type InfinitePage} from '../apps/web/src/infinite-list-data';
type Row={id:string;name:string};
const row=(id:number,name=`Person ${id}`):Row=>({id:String(id),name});
const page=(ids:number[],nextOffset:number|null):InfinitePage<Row>=>({items:ids.map(id=>row(id)),nextOffset});
const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settled=async(list:InfiniteListData<Row>)=>vi.waitFor(()=>expect(list.getSnapshot().loading).toBe(false));

it('appends and deduplicates pages, serializes reads, and stops at the end',async()=>{
 const next=deferred<InfinitePage<Row>>();
 const read=vi.fn(async(offset:number)=>offset===0?page([1,2],2):next.promise);
 const list=new InfiniteListData<Row>(item=>item.id);list.reset(read);await settled(list);
 list.loadMore();list.loadMore();expect(read).toHaveBeenCalledTimes(2);
 expect(list.getSnapshot().items.map(item=>item.id)).toEqual(['1','2']);
 next.resolve(page([2,3],null));await settled(list);
 expect(list.getSnapshot().items.map(item=>item.id)).toEqual(['1','2','3']);
 list.loadMore();expect(read).toHaveBeenCalledTimes(2);
});

it('aborts an old search and ignores its late result after the filter changes',async()=>{
 const old=deferred<InfinitePage<Row>>();let signal:AbortSignal|undefined;
 const list=new InfiniteListData<Row>(item=>item.id);
 list.reset(async(_offset,s)=>{signal=s;return old.promise;});
 list.reset(async()=>page([9],null));expect(signal?.aborted).toBe(true);await settled(list);
 old.resolve(page([1,2],2));await Promise.resolve();await Promise.resolve();
 expect(list.getSnapshot().items.map(item=>item.id)).toEqual(['9']);
});

it('keeps loaded rows on error and retries the failed offset',async()=>{
 const offsets:number[]=[];let fail=true;
 const list=new InfiniteListData<Row>(item=>item.id);
 list.reset(async offset=>{offsets.push(offset);if(offset&&fail)throw Error('Offline');return offset?page([3,4],null):page([1,2],2);});
 await settled(list);list.loadMore();await settled(list);
 expect(list.getSnapshot()).toMatchObject({error:'Offline',nextOffset:2});
 expect(list.getSnapshot().items).toHaveLength(2);
 fail=false;list.retry();await settled(list);
 expect(offsets).toEqual([0,2,2]);expect(list.getSnapshot().items).toHaveLength(4);
});

it('refreshes every loaded page without collapsing the visible list after edits',async()=>{
 let version='old';const gate=deferred<InfinitePage<Row>>();const offsets:number[]=[];
 const list=new InfiniteListData<Row>(item=>item.id);
 list.reset(async offset=>{offsets.push(offset);if(version==='waiting')return gate.promise;return {items:[row(offset+1,version),row(offset+2,version)],nextOffset:offset+2};});
 await settled(list);list.loadMore();await settled(list);
 version='waiting';list.refresh();expect(list.getSnapshot().items).toHaveLength(4);
 version='edited';gate.resolve({items:[row(1,version),row(2,version)],nextOffset:2});await settled(list);
 expect(offsets).toEqual([0,2,0,2]);expect(list.getSnapshot().items).toHaveLength(4);
 expect(list.getSnapshot().items.every(item=>item.name==='edited')).toBe(true);
});

it('queues a single refresh when an edit finishes during a page read',async()=>{
 const next=deferred<InfinitePage<Row>>();let paused=true;const offsets:number[]=[];
 const list=new InfiniteListData<Row>(item=>item.id);
 list.reset(async offset=>{offsets.push(offset);return offset===0?page([1,2],2):paused?next.promise:page([3,4],null);});
 await settled(list);list.loadMore();list.refresh();list.refresh();paused=false;next.resolve(page([3,4],null));await settled(list);
 expect(offsets).toEqual([0,2,0,2]);expect(list.getSnapshot().items).toHaveLength(4);
});

it('rejects looping cursors and repeated rows instead of requesting pages forever',async()=>{
 for(const bad of [page([3],2),page([1,2],4)]){
  const list=new InfiniteListData<Row>(item=>item.id);
  const read=vi.fn(async(offset:number)=>offset?bad:page([1,2],2));
  list.reset(read);await settled(list);list.loadMore();await settled(list);
  expect(list.getSnapshot().error).toMatch(/did not advance|no new rows/);
  expect(list.getSnapshot().items).toHaveLength(2);expect(read).toHaveBeenCalledTimes(2);
 }
});
