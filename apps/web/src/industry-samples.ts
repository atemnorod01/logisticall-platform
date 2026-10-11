// Shared deterministic sample registry. This is identical for every tenant.
export type IndustryCompany={id:string;name:string;type:string;location:string;mc:string;dot:string;phone:string;ff?:string};
const known:IndustryCompany[]=[
{id:'soteria',name:'Soteria Logistics',type:'Carrier',location:'Chicago, IL',mc:'876543',dot:'3456789',phone:'(773) 555-0100'},
{id:'northline',name:'Northline Logistics',type:'Broker',location:'Chicago, IL',mc:'765432',dot:'2345671',phone:'(312) 555-0100'},
{id:'prairie',name:'Prairie Ridge Transport',type:'Carrier',location:'Omaha, NE',mc:'123456',dot:'2345678',phone:'(402) 555-0136'},
{id:'harbor',name:'Harbor Freight Partners',type:'Broker',location:'Cleveland, OH',mc:'654321',dot:'4567890',phone:'(216) 555-0100'},
{id:'atlas',name:'Atlas Forwarding',type:'Freight forwarder',location:'Newark, NJ',mc:'',dot:'5678901',phone:'(973) 555-0142',ff:'012345'},
];
const regions=['Cedar','Prairie','Summit','Harbor','Blue Ridge','Great Lakes','Red River','Silver Creek','Pine Valley','Oak Ridge','Clearwater','Stonebridge','Maple','Highland','Westwind','Eastgate','Evergreen','Golden Plains','Northstar','Pacific'];
const names=['Ridge','Valley','Trail','Coast','Express','Gateway','Horizon','Bridge','Peak','Crossroads','Point','Central'];
const cities=['Chicago, IL','Omaha, NE','Dallas, TX','Atlanta, GA','Columbus, OH','Phoenix, AZ','Newark, NJ','Portland, OR','Denver, CO','Memphis, TN','Charlotte, NC','Kansas City, MO'];
export const industryCompanies:IndustryCompany[]=[...known,...Array.from({length:240},(_,i)=>{
 const type=['Carrier','Broker','Freight forwarder'][i%3]!;
 return {id:`sample-${i+1}`,name:`${regions[Math.floor(i/12)]} ${names[i%12]} ${type==='Carrier'?'Transport':type==='Broker'?'Freight Partners':'Forwarding'}`,type,location:cities[i%12]!,mc:type==='Freight forwarder'?'':String(200000+i),dot:String(6000000+i),...(type==='Freight forwarder'?{ff:String(200000+i)}:{}),phone:`(312) 555-01${String(i%100).padStart(2,'0')}`};
})];
