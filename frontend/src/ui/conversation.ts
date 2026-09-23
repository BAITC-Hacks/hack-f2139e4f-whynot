import type { ProposalMessage } from '../types';

export function mergeMessages(current:ProposalMessage[],incoming:ProposalMessage[]):ProposalMessage[]{
  const messages=new Map(current.map(message=>[message.id,message]));
  incoming.forEach(message=>messages.set(message.id,message));
  return [...messages.values()].sort((a,b)=>a.id-b.id);
}
// Only messages read from the ordered feed advance the cursor. A send response
// may arrive before unread messages and must never make the feed skip them.
export function messageCursor(current:number,page:ProposalMessage[]):number{
  return page.reduce((cursor,message)=>Math.max(cursor,message.id),current);
}
export function messageTime(value:string):string{
  return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
}
