import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const source=await readFile('firmware/MyEpaperApp/MyEpaperApp.ino','utf8');
const fn=source.slice(source.indexOf('void buttonsTask(void*)'),source.indexOf('\nint request('));
const dir=await mkdtemp(join(tmpdir(),'pomo-buttons-'));
const header=source.includes('#include "button_gesture.h"')?'#include "button_gesture.h"':'';
const harness=`#include <cstdint>
#include <cstdio>
#include <vector>
${header}
#define BOOT_BUTTON_PIN 0
#define PWR_BUTTON_PIN 18
#define INPUT_PULLUP 1
#define pdMS_TO_TICKS(x) (x)
struct Stop {};
uint32_t clockMs; int mode; bool wifiSetupRequested=false;
struct Event {bool boot,hold;}; std::vector<Event> events;
void pinMode(int,int){}
uint32_t millis(){return clockMs;}
int digitalRead(int pin){
 if(pin==BOOT_BUTTON_PIN)return 1;
 if(mode==0)return clockMs>=10100 && clockMs<10300?0:1;
 if(mode==1)return clockMs<10300?0:1;
 return clockMs>=10100 && clockMs<13000?0:1;
}
void buttonEvent(bool boot,bool hold){events.push_back({boot,hold});}
void vTaskDelay(int ms){clockMs+=ms;if(clockMs>14000)throw Stop{};}
${fn}
int main(){
 for(mode=0;mode<3;mode++){
  clockMs=10000;events.clear();try{buttonsTask(nullptr);}catch(Stop&){}
  int shortCount=0,holdCount=0;for(auto event:events)if(!event.boot){if(event.hold)holdCount++;else shortCount++;}
  const int expectedShort=mode==0?1:0,expectedHold=mode==2?1:0;
  if(shortCount!=expectedShort || holdCount!=expectedHold){fprintf(stderr,"PWR scenario %d: short=%d hold=%d; expected short=%d hold=%d\\n",mode,shortCount,holdCount,expectedShort,expectedHold);return 1;}
 }
}
`;
try {
 await writeFile(join(dir,'harness.cpp'),harness);
 const build=spawnSync('c++',['-std=c++17','-I',resolve('firmware/MyEpaperApp'),join(dir,'harness.cpp'),'-o',join(dir,'test')],{encoding:'utf8'});
 assert.equal(build.status,0,build.stderr);
 const test=spawnSync(join(dir,'test'),[],{encoding:'utf8'});
 assert.equal(test.status,0,test.stderr);
 console.log('PWR driver regression passed: tap once, ignore startup hold, deliberate hold once.');
}finally{await rm(dir,{recursive:true,force:true});}
