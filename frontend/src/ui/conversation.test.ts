import { describe, expect, it } from 'vitest';
import { mergeMessages, messageCursor } from './conversation';
import type { ProposalMessage } from '../types';
const message=(id:number,body=`Message ${id}`):ProposalMessage=>({id,body,proposal_id:'proposal',sender_id:'student',sender_name:'Студент',sender_role:'student',created_at:'2026-09-23T12:00:00Z'});

describe('Пагинация переписки',()=>{
  it('объединяет polling и ответ отправки без дублей и сохраняет порядок',()=>{
    const merged=mergeMessages([message(2),message(5)],[message(3),message(5,'Updated')]);
    expect(merged.map(item=>item.id)).toEqual([2,3,5]);expect(merged[2].body).toBe('Updated');
  });
  it('не пропускает непрочитанные сообщения, когда ответ отправки опередил polling',()=>{
    const firstPage=[message(1),message(2)];let cursor=messageCursor(0,firstPage);
    const withSent=mergeMessages(firstPage,[message(8)]);
    const nextPage=[message(3),message(4)];cursor=messageCursor(cursor,nextPage);
    expect(cursor).toBe(4);expect(mergeMessages(withSent,nextPage).map(item=>item.id)).toEqual([1,2,3,4,8]);
    expect(messageCursor(cursor,[])).toBe(4);
  });
});
