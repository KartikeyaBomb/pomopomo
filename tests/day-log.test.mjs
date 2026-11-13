import test from 'node:test';
import assert from 'node:assert/strict';
import { activityDate, dateKey, activityDayRange, dayLogLines, formatDayLog, activitySchema } from '../lib/activity.ts';
process.env.TZ='America/Chicago';
const time=(day,hour,minute=0,second=0)=>new Date(2026,10,day,hour,minute,second).getTime();
const entry=(name,start,end,segments)=>({id:`focus:${name}:${end}`,mode:'focus',taskId:name,taskName:name,completedAt:end,durationSeconds:1500,...(segments?{segments}: {segments:[{start,end}]})});
const date=new Date(2026,10,12,12);
test('copy log follows requested format, chronological order, and blank lines at one-minute gaps',()=>{
 const a=entry('astronomy hw',time(12,19,3),time(12,19,28)),b=entry('ASSIST',time(12,19,35),time(12,20));
 assert.equal(formatDayLog(dayLogLines([b,a],date)),'7:03 - 7:28 astronomy hw\n\n7:35 - 8 ASSIST');
 const gap=entry('next',a.completedAt+60000,a.completedAt+1560000);
 assert.ok(formatDayLog(dayLogLines([a,gap],date)).includes('\n\n'));
 const close=entry('next',a.completedAt+59000,a.completedAt+1559000);
 assert.ok(!formatDayLog(dayLogLines([a,close],date)).includes('\n\n'));
});
test('only completed focus entries appear; adjacent same-task sessions become one work block',()=>{
 const a=entry('task',time(12,9),time(12,9,25)),b=entry('task',time(12,9,25),time(12,9,50));
 const rest={...entry('break',time(12,9,50),time(12,9,55)),mode:'break',durationSeconds:300};
 assert.equal(formatDayLog(dayLogLines([a,b,a,rest],date)),'9 - 9:50 task');
});
test('2 AM belongs to the previous day, but exactly 8 AM starts a new day',()=>{
 assert.equal(dateKey(activityDate(new Date(time(13,2)))),'2026-11-12');
 assert.equal(dateKey(activityDate(new Date(time(13,8)))),'2026-11-13');
 const night=entry('late work',time(13,2),time(13,2,25));
 assert.equal(formatDayLog(dayLogLines([night],date)),'2 - 2:25 late work');
 assert.equal(dayLogLines([night],new Date(2026,10,13,12)).length,0);
});
test('8 AM boundary splits work between days, including a completed session from the following day',()=>{
 const cross=entry('crossing',time(13,7,50),time(13,8,15));
 assert.equal(formatDayLog(dayLogLines([cross],date)),'7:50 - 8 crossing');
 assert.equal(formatDayLog(dayLogLines([cross],new Date(2026,10,13,12))),'8 - 8:15 crossing');
});
test('pause gaps remain blank and legacy timing is explicitly estimated',()=>{
 const paused=entry('work',time(12,9),time(12,10),[{start:time(12,9),end:time(12,9,10)},{start:time(12,9,45),end:time(12,10)}]);
 assert.equal(formatDayLog(dayLogLines([paused],date)),'9 - 9:10 work\n\n9:45 - 10 work');
 const {segments,...legacy}=entry('older',time(12,11),time(12,11,25));
 assert.equal(dayLogLines([legacy],date)[0].estimated,true);
 assert.equal(dayLogLines([paused],date)[0].estimated,false);
});
test('month boundaries, local DST, and invalid segment ordering are handled',()=>{
 assert.equal(dateKey(activityDate(new Date(2026,11,1,2))),'2026-11-30');
 const fall=activityDayRange(new Date(2026,9,31,12)); assert.equal(fall.end-fall.start,25*3600000);
 const spring=activityDayRange(new Date(2026,2,7,12)); assert.equal(spring.end-spring.start,23*3600000);
 const bad=entry('bad',time(12,9),time(12,10),[{start:time(12,9,45),end:time(12,10)},{start:time(12,9),end:time(12,9,10)}]);
 assert.equal(activitySchema.safeParse(bad).success,false);
});
