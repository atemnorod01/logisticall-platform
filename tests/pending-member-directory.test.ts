import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {managedMember,memberEdit} from '../packages/types/src/settings';

it('shows pending invitees with no editing permissions, preserving tenant boundaries, search and paging',async()=>{
 const db=new PGlite();
 const org='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
 const actor='30000000-0000-4000-8000-000000000001',person='30000000-0000-4000-8000-000000000002',seat='40000000-0000-4000-8000-000000000001';
 try{
  await db.exec(`create schema auth;create schema iam_private;
   create table public.memberships(organization_id uuid,user_id uuid,role_id text,status text,invitation_id uuid);
   create table public.profiles(id uuid,display_name text);
   create table auth.users(id uuid,email text);
   create table public.invitations(id uuid,organization_id uuid,accepted_at timestamptz,revoked_at timestamptz);
   create function iam_private.settings_admin(org uuid) returns uuid language plpgsql as $$begin
    if current_setting('test.allowed',true) is distinct from 'yes' or org<>'${org}' then raise exception 'Access denied' using errcode='42501'; end if;return '${actor}';end $$;
   insert into memberships values('${org}','${actor}','owner','active',null),('${org}','${person}','member','pending','${seat}'),('${other}','30000000-0000-4000-8000-000000000003','member','active',null);
   insert into profiles values('${actor}','Owner'),('${person}','Invitee'),('30000000-0000-4000-8000-000000000003','Other');
   insert into auth.users values('${actor}','owner@example.com'),('${person}','invited@example.com'),('30000000-0000-4000-8000-000000000003','other@example.com');
   insert into invitations values('${seat}','${org}',null,null);`);
  await db.exec(await readFile('infrastructure/iam-staging/migrations/202610190001_pending_member_directory.sql','utf8'));
  const list=async(search='',offset=0)=>(await db.query<{data:unknown[]}>(`select integration_members($1,$2,$3) as data`,[org,offset,search])).rows[0]!.data;
  await expect(list()).rejects.toThrow('Access denied');
  await db.exec("set test.allowed='yes'");
  const rows=(await list()).map(x=>managedMember.parse(x));
  expect(rows.map(x=>x.email)).toEqual(['invited@example.com','owner@example.com']);
  expect(rows[0]).toMatchObject({status:'pending',can_edit_name:false,can_edit_access:false,can_edit_role:false});
  expect(await list('INVITED')).toHaveLength(1);expect(await list('',1)).toHaveLength(1);
  await expect(db.query('select integration_members($1)',[other])).rejects.toThrow('Access denied');
  expect(memberEdit.safeParse({name:'Invitee',role_id:'member',status:'active',expected:{name:'Invitee',role_id:'member',status:'pending'}}).success).toBe(false);
  await db.exec(`update invitations set revoked_at=now() where id='${seat}'`);
  expect(await list()).toHaveLength(1);
  expect((await db.query<{status:string}>(`select status from memberships where user_id='${person}'`)).rows[0]!.status).toBe('pending');
 }finally{await db.close();}
});
