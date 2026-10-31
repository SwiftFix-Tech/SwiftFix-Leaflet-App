-- Supabase PostgreSQL. Run once as project owner using the SQL editor or CLI.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create table public.workspaces (
 id uuid primary key, name text not null, revision bigint not null default 0
);
insert into public.workspaces(id,name) values ('5c7c15a9-3757-4c87-85d3-a5d671642f36','SwiftFix Tech');
create table public.workspace_members (
 workspace_id uuid references public.workspaces on delete cascade,
 user_id uuid references auth.users on delete cascade,
 primary key(workspace_id,user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);
create table public.road_datasets (
 version text primary key, source_url text not null, sha256 text not null,
 imported_at timestamptz not null default now(), active boolean not null default false
);
create unique index one_active_dataset on public.road_datasets(active) where active;
create table public.road_segments (
 id text primary key, dataset_version text not null references public.road_datasets(version),
 road_name text not null, osm_way_id bigint not null,
 geom extensions.geometry(LineString,4326) not null
);
create index road_segments_geom_idx on public.road_segments using gist(geom);
create index road_segments_dataset_keyset_idx on public.road_segments(dataset_version,id);
create table public.completed_roads (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces,
 user_id uuid references auth.users on delete set null,
 road_segment_id text not null references public.road_segments(id),
 road_name text not null, geometry_reference text not null,
 geom extensions.geometry(LineString,4326) not null,
 completed_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(workspace_id,road_segment_id)
);
create index completed_roads_geom_idx on public.completed_roads using gist(geom);
create table public.road_revisions (
 workspace_id uuid references public.workspaces, road_segment_id text references public.road_segments,
 revision uuid not null default gen_random_uuid(), primary key(workspace_id,road_segment_id)
);

-- SECURITY DEFINER helper avoids recursive membership policies. No client may add members.
create function public.is_workspace_member(p_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=auth.uid());
$$;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.road_datasets enable row level security;
alter table public.road_segments enable row level security;
alter table public.completed_roads enable row level security;
alter table public.road_revisions enable row level security;
create policy workspace_read on public.workspaces for select to authenticated using(public.is_workspace_member(id));
create policy membership_read on public.workspace_members for select to authenticated using(user_id=auth.uid());
create policy datasets_read on public.road_datasets for select to authenticated using(exists(select 1 from public.workspace_members where user_id=auth.uid()));
create policy roads_read on public.road_segments for select to authenticated using(exists(select 1 from public.workspace_members where user_id=auth.uid()));
create policy completed_read on public.completed_roads for select to authenticated using(public.is_workspace_member(workspace_id));
create policy revisions_read on public.road_revisions for select to authenticated using(public.is_workspace_member(workspace_id));
revoke all on public.workspaces, public.workspace_members, public.road_datasets, public.road_segments, public.completed_roads, public.road_revisions from anon, authenticated;
grant select on public.workspaces, public.workspace_members, public.road_datasets, public.road_segments, public.completed_roads, public.road_revisions to authenticated;
grant usage on schema public,extensions to authenticated;

-- Atomic writes only through this membership-checked RPC; callers cannot forge geometry.
create function public.set_completed(p_workspace uuid,p_segment text,p_completed boolean,p_expected uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.road_segments; v uuid; was boolean; changed boolean;
begin
 if not public.is_workspace_member(p_workspace) then raise exception 'Not authorised' using errcode='42501'; end if;
 -- Workspace row serializes count/revision snapshots and all staff writes.
 perform 1 from public.workspaces where id=p_workspace for update;
 select * into r from public.road_segments where id=p_segment;
 if not found then raise exception 'Road segment not found'; end if;
 if p_completed and not exists(select 1 from public.road_datasets where version=r.dataset_version and active) then
   raise exception 'The road dataset has changed. Refresh the map before marking.';
 end if;
 insert into public.road_revisions(workspace_id,road_segment_id) values(p_workspace,p_segment) on conflict do nothing;
 select revision into v from public.road_revisions where workspace_id=p_workspace and road_segment_id=p_segment for update;
 if p_expected is not null and p_expected<>v then raise exception 'This road changed since your action. Refresh before trying again.' using errcode='40001'; end if;
 select exists(select 1 from public.completed_roads where workspace_id=p_workspace and road_segment_id=p_segment) into was;
 changed := was<>p_completed;
 if changed then
   if p_completed then
     insert into public.completed_roads(workspace_id,user_id,road_segment_id,road_name,geometry_reference,geom)
     values(p_workspace,auth.uid(),r.id,r.road_name,r.dataset_version,r.geom);
   else
     delete from public.completed_roads where workspace_id=p_workspace and road_segment_id=p_segment;
   end if;
   v:=gen_random_uuid();
   update public.road_revisions set revision=v where workspace_id=p_workspace and road_segment_id=p_segment;
   update public.workspaces set revision=revision+1 where id=p_workspace;
 end if;
 return jsonb_build_object('changed',changed,'revision',v,'completed',p_completed);
end $$;

-- One consistent database snapshot; spatial index, explicit bounds, no silent row-limit truncation.
create function public.tracker_view(p_workspace uuid,p_bounds double precision[],p_zoom double precision)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare box extensions.geometry; roads jsonb:='[]'; completed jsonb; n bigint; rev bigint; dataset text;
begin
 if not public.is_workspace_member(p_workspace) then raise exception 'Not authorised' using errcode='42501'; end if;
 if array_length(p_bounds,1)<>4 or p_bounds[1] < -9 or p_bounds[3]>3 or p_bounds[2]<49 or p_bounds[4]>61.5
   or p_bounds[1]>=p_bounds[3] or p_bounds[2]>=p_bounds[4] then raise exception 'Invalid UK viewport'; end if;
 box:=extensions.st_makeenvelope(p_bounds[1],p_bounds[2],p_bounds[3],p_bounds[4],4326);
 select count(*) into n from public.completed_roads where workspace_id=p_workspace;
 select revision into rev from public.workspaces where id=p_workspace;
 select version into dataset from public.road_datasets where active;
 if p_zoom>=14 and (p_bounds[3]-p_bounds[1])*(p_bounds[4]-p_bounds[2])<=0.08 then
   if not exists(select 1 from public.road_datasets where active) then raise exception 'UK road dataset has not been imported and activated'; end if;
   select coalesce(jsonb_agg(jsonb_build_object('type','Feature','id',id,'properties',jsonb_build_object('id',id,'name',road_name),'geometry',extensions.st_asgeojson(geom)::jsonb)),'[]') into roads
   from (select s.* from public.road_segments s join public.road_datasets d on s.dataset_version=d.version
     where d.active and s.geom && box order by s.id limit 750) s;
 end if;
 -- Highlights at street level; broad zoom shows basemap and total count, avoids nationwide geometry.
 if p_zoom>=12 and (p_bounds[3]-p_bounds[1])*(p_bounds[4]-p_bounds[2])<=0.5 then
   select coalesce(jsonb_agg(jsonb_build_object('type','Feature','id',c.road_segment_id,'properties',jsonb_build_object('id',c.road_segment_id,'name',c.road_name,'completed',true),'geometry',extensions.st_asgeojson(c.geom)::jsonb)),'[]') into completed
   from (select * from public.completed_roads where workspace_id=p_workspace and geom && box order by road_segment_id limit 750) c;
 else completed:='[]'; end if;
 return jsonb_build_object('roads',jsonb_build_object('type','FeatureCollection','features',roads),'completed',jsonb_build_object('type','FeatureCollection','features',completed),'count',n,'revision',rev,'dataset',dataset);
end $$;
-- Keyset pages return whole segments, never tile fragments. Revisions detect cross-page edits.
create function public.tracker_page(p_workspace uuid,p_bounds double precision[],p_kind text,p_dataset text,p_after text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare box extensions.geometry; features jsonb; rev bigint; dataset text;
begin
 if not public.is_workspace_member(p_workspace) then raise exception 'Not authorised' using errcode='42501'; end if;
 if array_length(p_bounds,1)<>4 or p_bounds[1]<-9 or p_bounds[3]>3 or p_bounds[2]<49 or p_bounds[4]>61.5
   or p_bounds[1]>=p_bounds[3] or p_bounds[2]>=p_bounds[4]
   or (p_bounds[3]-p_bounds[1])*(p_bounds[4]-p_bounds[2])>0.5 then raise exception 'Invalid street viewport'; end if;
 box:=extensions.st_makeenvelope(p_bounds[1],p_bounds[2],p_bounds[3],p_bounds[4],4326);
 select revision into rev from public.workspaces where id=p_workspace;
 select version into dataset from public.road_datasets where active;
 if p_kind='roads' then
   select coalesce(jsonb_agg(jsonb_build_object('type','Feature','id',s.id,'properties',jsonb_build_object('id',s.id,'name',s.road_name),'geometry',extensions.st_asgeojson(s.geom)::jsonb)),'[]') into features
   from (select * from public.road_segments where dataset_version=p_dataset and geom && box and id>p_after order by id limit 750) s;
 elsif p_kind='completed' then
   select coalesce(jsonb_agg(jsonb_build_object('type','Feature','id',s.road_segment_id,'properties',jsonb_build_object('id',s.road_segment_id,'name',s.road_name,'completed',true),'geometry',extensions.st_asgeojson(s.geom)::jsonb)),'[]') into features
   from (select * from public.completed_roads where workspace_id=p_workspace and geom && box and road_segment_id>p_after order by road_segment_id limit 750) s;
 else raise exception 'Invalid page kind'; end if;
 return jsonb_build_object('features',features,'revision',rev,'dataset',dataset);
end $$;
revoke all on function public.is_workspace_member(uuid),public.set_completed(uuid,text,boolean,uuid),public.tracker_view(uuid,double precision[],double precision) from public,anon;
grant execute on function public.is_workspace_member(uuid),public.set_completed(uuid,text,boolean,uuid),public.tracker_view(uuid,double precision[],double precision) to authenticated;
revoke all on function public.tracker_page(uuid,double precision[],text,text,text) from public,anon;
grant execute on function public.tracker_page(uuid,double precision[],text,text,text) to authenticated;
-- Only workspace revision is broadcast. Each client reloads visible data and total count through RLS.
alter publication supabase_realtime add table public.workspaces;
