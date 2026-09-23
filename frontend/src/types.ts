export type Readiness = 'draft' | 'working' | 'ready' | 'priority';
export type CardField = 'title' | 'topic' | 'context' | 'need' | 'users' | 'data' | 'constraints' | 'expected_result' | 'success_criteria' | 'contact' | 'interaction_format';
export type FieldKey = Exclude<CardField, 'topic'>;
export type CardData = Record<CardField, string>;
export type Card = CardData;
export interface ScoreItem { key:string; label:string; points:number; max_points:number; missing_fields:CardField[]; unconfirmed_fields:CardField[]; suggestion:string }
export interface Rating { score:number; preview_score:number; readiness:Readiness; breakdown:ScoreItem[]; missing_fields:CardField[]; unconfirmed_fields:CardField[] }
export interface Task { id:string; owner_id:string; raw_description:string; card:CardData; revision:number; confirmed_revision:number|null; published_revision:number|null; confirmed_fields:CardField[]; status:'draft'|'published'; rating:Rating; created_at:string }
export interface CatalogTask { id:string; card:CardData; revision:number; rating:Rating; published_at:string }
export interface CatalogPage { items:CatalogTask[]; total:number; limit:number; offset:number }
export interface Actor { id:string; name:string; role:'business'|'student'; email?:string; username?:string|null }
export interface StudentProfileInput { username:string; phone:string; positions:string[]; skills:string[] }
export interface StudentProfile extends Omit<StudentProfileInput,'username'> { actor_id:string; username:string|null }
export type RegistrationInput = { name:string; email:string; password:string } & ({role:'business'} | ({role:'student'} & StudentProfileInput));
export interface TeamInput { name:string; interests:string[]; skills:string[]; technologies:string[] }
export interface TeamMember { actor_id:string; name:string; username:string|null; positions:string[]; skills:string[]; is_leader:boolean }
export interface Team extends TeamInput { id:string; owner_id:string; points:number; members?:TeamMember[]; member_count?:number; ready?:boolean; is_leader?:boolean; invite_code?:string|null }
export interface ProposalContact { name:string; username:string|null; phone:string }
export interface ProposalMessage { id:number; proposal_id:string; sender_id:string; sender_name:string; sender_role:'business'|'student'; body:string; created_at:string }
export interface MessagePage { items:ProposalMessage[]; has_more:boolean }
export interface ProposalInput { idea:string; plan:string; timeline:string; prototype_url:string|null }
export interface Proposal extends ProposalInput { id:string; task_id:string; team_id:string; status:'pending'|'accepted'|'rejected'; decision_note:string; created_at:string; decided_at:string|null }
export type MilestoneCode = 'prototype'|'pilot'|'delivery';
export interface Milestone { id:string; proposal_id:string; code:MilestoneCode; evidence:string; points:number; confirmed_by:string; confirmed_at:string }
export interface Question { field:CardField; question:string }
export interface AssistResult { provider:'stub'|'ollama'|'openai'; fallback_reason:string|null; based_on_revision:number; suggested_card:CardData; questions:Question[]; missing_fields:CardField[] }
export interface CatalogFilters { topic?:string; readiness?:Readiness; limit?:number; offset?:number }
export interface TaskCreateInput { raw_description:string; topic:string; title?:string }
