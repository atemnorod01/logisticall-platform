import {expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {directoryResult} from '../packages/types/src/index';

it('shows valid pending coworkers without treating them as active accounts',async()=>{
 const db=new PGlite(),org='20000000-0000-4000-8000-000000000001',active='30000000-0000-4000-8000-000000000001',pending='30000000-0000-4000-8000-000000000002',seat='40000000-0000-4000-8000-000000000001';
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create table public.memberships(organization_id uuid,user_id uuid,status text,invitation_id uuid,archived_at timestamptz,removal_started_at timestamptz);
   create table public.profiles(id uuid,display_name text,status text);
   create table auth.users(id uuid,email text,email_confirmed_at timestamptz,banned_until timestamptz);
   create table public.invitations(id uuid,organization_id uuid,accepted_at timestamptz,revoked_at timestamptz,expires_at timestamptz);
   create function public.integration_organization_context(id uuid) returns jsonb language plpgsql as $$begin if current_setting('test.allowed',true) is distinct from 'yes' or id<>'${org}' then raise exception 'Access denied' using errcode='42501';end if;return '{}'::jsonb;end$$;
   insert into profiles values('${active}','Owner','active'),('${pending}','Invitee','active');
   insert into auth.users values('${active}','owner@example.com',now(),null),('${pending}','invitee@example.com',null,null);
   insert into memberships values('${org}','${active}','active',null,null,null),('${org}','${pending}','pending','${seat}',null,null);
   insert into invitations values('${seat}','${org}',null,null,now()+interval '7 days');`);
  await db.exec(await readFile('infrastructure/iam-staging/migrations/202610190004_pending_contact_directory.sql','utf8'));
  await expect(db.query('select integration_directory($1)',[org])).rejects.toThrow('Access denied');
  await db.exec("set test.allowed='yes'");
  const value=(await db.query<{result:unknown}>('select integration_directory($1) as result',[org])).rows[0]!.result;
  expect(directoryResult.parse(value).contacts).toEqual([
   {id:pending,name:'Invitee',email:'invitee@example.com',status:'pending',presence:'unknown'},
   {id:active,name:'Owner',email:'owner@example.com',status:'active',presence:'unknown'},
  ]);
  await db.exec(`update invitations set revoked_at=now() where id='${seat}'`);
  const after=(await db.query<{result:{contacts:unknown[]}}>('select integration_directory($1) as result',[org])).rows[0]!.result;
  expect(after.contacts).toHaveLength(1);
 }finally{await db.close();}
});
