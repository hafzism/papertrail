import {randomUUID} from "node:crypto";
import type {Sql} from "postgres";

/** All public directory/rule fixtures and private activity effects roll back. */
export async function smokeFollowupRules(sql:Sql,ownerId:string):Promise<string>{
  const rolledBack=new Error("ROLL_BACK_SYNTHETIC_FOLLOWUP_FIXTURES");
  const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
  try{
    await sql.begin(async tx=>{
      await tx`select set_config('request.jwt.claim.sub',${ownerId},true)`;
      await tx`select set_config('request.jwt.claims',${JSON.stringify({sub:ownerId,role:"authenticated"})},true)`;
      const institution=randomUUID(),program=randomUUID(),proposal=randomUUID(),source=randomUUID(),observation=randomUUID(),revision=randomUUID();
      const url=`https://example.org/fictional-${program}`;
      await tx`insert into public.institutions(id,name)values(${institution},'Synthetic follow-up smoke institution')`;
      await tx`insert into public.programs(id,institution_id,name,canonical_slug,is_demo)values(${program},${institution},'Synthetic program',${program},true)`;
      await tx`insert into public.directory_proposals(id,owner_id,institution_name,program_name,cycle_label,source_url)values(${proposal},${ownerId},'Synthetic institution','Synthetic program','DEMO',${url})`;
      await tx`insert into public.published_program_sources(id,program_id,proposal_id,source_url)values(${source},${program},${proposal},${url})`;
      await tx`insert into public.published_source_observations(id,source_id,state,content_sha256)values(${observation},${source},'changed_candidate',${"0".repeat(64)})`;
      await tx`insert into public.published_notice_revisions(id,program_id,source_id,observation_id,source_url,content_sha256,moderator_id)values(${revision},${program},${source},${observation},${url},${"0".repeat(64)},${ownerId})`;
      await tx`insert into public.platform_roles(user_id,role,assigned_by)values(${ownerId},'notice_moderator',${ownerId})on conflict do nothing`;
      const activity=(await tx`select public.create_owner_tracked_activity('enrollment','Synthetic enrollment','{}'::jsonb)as id`)[0]!.id;
      await tx`select public.configure_activity_notice_scope(${activity},${program},'{}'::jsonb)`;
      await tx`select public.set_activity_followup_opt_in(${activity},true)`;
      await tx`select public.publish_followup_rule(${revision},'enrollment','{"session":"A","term":1}'::jsonb,'exam.registration','DEMO-2027','Synthetic exam registration','Synthetic reviewed citation',now()+interval '2 days','Synthetic test deadline')`;
      const action=async()=> (await tx`select * from public.followup_actions where activity_id=${activity} and action_family_key='exam.registration'`)[0]!;
      assert((await action()).state==='needs_clarification','missing scope did not require clarification');
      await tx`select public.configure_activity_notice_scope(${activity},${program},'{"session":"B"}'::jsonb)`;
      assert((await action()).state==='not_applicable','known mismatch was treated as a missing-answer alert');
      await tx`select public.configure_activity_notice_scope(${activity},${program},'{"session":"A","term":1}'::jsonb)`;
      const applicable=await action();assert(applicable.state==='available','corrected matching scope did not recover action');
      const linked=(await tx`select public.prepare_followup_application(${applicable.id},'Synthetic linked draft')as id`)[0]!.id;
      await tx`select public.evaluate_activity_followup_rules(${activity})`;
      assert((await action()).linked_application_id===linked,'reevaluation lost or duplicated linked draft');
      const reminder=(await tx`select public.record_owner_followup_action(${activity},'owner.review','DEMO','Synthetic reminder',now()+interval '2 days','Owner-recorded deadline')as id`)[0]!.id;
      const provenance=await tx`select trigger_evidence_version_id from public.followup_actions where id=${reminder}`;
      assert(provenance[0]?.trigger_evidence_version_id,'owner reminder omitted its evidence provenance');
      await tx`select public.enqueue_due_followup_reminders()`;await tx`select public.enqueue_due_followup_reminders()`;
      const duplicate=await tx`select action_id from public.followup_reminder_log where action_id in(${reminder},${applicable.id})group by action_id having count(*)>1`;
      assert(duplicate.length===0,'same reminder window was queued twice');
      await tx`select public.set_activity_followup_opt_in(${activity},false)`;
      await tx`update public.followup_actions set cited_reason='{}'::jsonb where id=${applicable.id}`;
      await tx`select public.evaluate_activity_followup_rules(${activity})`;
      assert(JSON.stringify((await action()).cited_reason)==='{}','paused tracking still evaluated new rules');
      throw rolledBack;
    });
  }catch(error){if(error!==rolledBack)throw error;}
  return "follow-up: scoped matching, correction recovery, linked draft, reminder provenance/deduplication and opt-out";
}
