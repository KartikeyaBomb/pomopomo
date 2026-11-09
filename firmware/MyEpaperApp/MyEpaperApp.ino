// Foundation: Waveshare 09_LVGL_V8_Test, approved by the owner.
// Target: ESP32-S3-ePaper-1.54 V2, non-touch. See ../../docs/EPAPER.md.
#include <Arduino.h>
#include <WiFi.h>
#include <NetworkClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <lvgl.h>
#include <vector>
#include <time.h>
#include <esp_timer.h>
#include <esp_sleep.h>
#include "user_config.h"
#include "trust_roots.h"
#include "src/display/epaper_driver_bsp.h"
#include "src/power/board_power_bsp.h"

struct TaskItem { String id, name; int left; };
struct Action { char type[12]; char taskId[101]; int64_t revision; };
Preferences prefs;
SemaphoreHandle_t stateMutex;
QueueHandle_t actionQueue;
epaper_driver_display *display;
board_power_bsp_t power(EPD_PWR_PIN, Audio_PWR_PIN, VBAT_PWR_PIN);
std::vector<TaskItem> tasks;
String selectedId, statusText = "Connecting", timerMode = "focus";
String gateway, deviceToken, pairingCode, pendingCommand;
int64_t revision = 0, deadline = 0, serverClock = 0;
uint32_t serverTick = 0, lastGood = 0;
int secondsRemaining = 1500, browseIndex = -1;
bool connected = false, awaiting = false, configuring = false, networkStarted = false;
volatile bool powerOff = false;
lv_obj_t *titleLabel, *timerLabel, *statusLabel, *helpLabel;
uint32_t lastPaint = 0; int partialCount = 0; String previousPaint;

String randomHex(size_t n) { String value; for (size_t i=0;i<n;i++) { char b[3]; snprintf(b,3,"%02x",(unsigned)(esp_random() & 255)); value += b; } return value; }
String uuid() { String s=randomHex(16); s.setCharAt(12,'4'); s.setCharAt(16,'8'); return s.substring(0,8)+"-"+s.substring(8,12)+"-"+s.substring(12,16)+"-"+s.substring(16,20)+"-"+s.substring(20); }
void setStatus(const String &text) { xSemaphoreTake(stateMutex,portMAX_DELAY); statusText=text; xSemaphoreGive(stateMutex); }
void flushDisplay(lv_disp_drv_t *drv,const lv_area_t *area,lv_color_t *colors) {
  display->EPD_Clear();
  for(int y=area->y1;y<=area->y2;y++) for(int x=area->x1;x<=area->x2;x++) {
    display->EPD_DrawColorPixel(x,y,lv_color_brightness(*colors++) < 128 ? DRIVER_COLOR_BLACK : DRIVER_COLOR_WHITE);
  }
  if (partialCount == 0 || partialCount >= 10) {
    display->EPD_Init(); display->EPD_DisplayPartBaseImage(); display->EPD_Init_Partial(); partialCount=1;
  } else { display->EPD_DisplayPart(); partialCount++; }
  lv_disp_flush_ready(drv);
}
lv_obj_t *label(int y,int height,const lv_font_t *font) {
  lv_obj_t *obj=lv_label_create(lv_scr_act()); lv_obj_set_pos(obj,8,y);lv_obj_set_size(obj,184,height);
  lv_label_set_long_mode(obj,LV_LABEL_LONG_WRAP);lv_obj_set_style_text_align(obj,LV_TEXT_ALIGN_CENTER,0);lv_obj_set_style_text_font(obj,font,0);return obj;
}
void setupDisplay() {
  custom_lcd_spi_t config={};config.cs=EPD_CS_PIN;config.dc=EPD_DC_PIN;config.rst=EPD_RST_PIN;config.busy=EPD_BUSY_PIN;config.mosi=EPD_MOSI_PIN;config.scl=EPD_SCK_PIN;config.spi_host=EPD_SPI_NUM;config.buffer_len=5000;
  display=new epaper_driver_display(200,200,config);
  lv_init();static lv_disp_draw_buf_t buffer;static lv_disp_drv_t driver;
  auto pixels=(lv_color_t*)heap_caps_malloc(200*200*sizeof(lv_color_t),MALLOC_CAP_SPIRAM);
  if(!pixels){Serial.println("PSRAM unavailable: select OPI PSRAM");while(true)delay(1000);}
  lv_disp_draw_buf_init(&buffer,pixels,nullptr,200*200);lv_disp_drv_init(&driver);driver.hor_res=200;driver.ver_res=200;driver.draw_buf=&buffer;driver.flush_cb=flushDisplay;driver.full_refresh=1;lv_disp_drv_register(&driver);
  lv_obj_set_style_bg_color(lv_scr_act(),lv_color_white(),0);lv_obj_set_style_text_color(lv_scr_act(),lv_color_black(),0);
  titleLabel=label(8,50,&lv_font_montserrat_14);timerLabel=label(65,40,&lv_font_montserrat_28);statusLabel=label(110,40,&lv_font_montserrat_14);helpLabel=label(156,40,&lv_font_montserrat_14);
}
// Short-press actions are queued only against a fresh, acknowledged revision.
void buttonEvent(bool boot,bool longPress) {
  xSemaphoreTake(stateMutex,portMAX_DELAY);
  if (!boot && longPress) { powerOff=true; xSemaphoreGive(stateMutex); return; }
  if (!connected || awaiting || millis()-lastGood>15000) { statusText="Offline: controls disabled"; xSemaphoreGive(stateMutex); return; }
  Action action={};action.revision=revision;
  if(boot && !longPress) {
    if(!tasks.empty()) browseIndex=(browseIndex+1)%(int)tasks.size();
  } else if(boot && longPress) {
    if(browseIndex>=0) browseIndex=-1; else {strlcpy(action.type,"reset",sizeof(action.type));}
  } else if(browseIndex>=0 && browseIndex<(int)tasks.size()) {
    strlcpy(action.type,"select",sizeof(action.type));strlcpy(action.taskId,tasks[browseIndex].id.c_str(),sizeof(action.taskId));browseIndex=-1;
  } else {strlcpy(action.type,deadline>0?"pause":"resume",sizeof(action.type));}
  if(action.type[0]) { if(xQueueSend(actionQueue,&action,0)==pdTRUE) { awaiting=true;statusText="Saving..."; } }
  xSemaphoreGive(stateMutex);
}
void buttonsTask(void*) {
  pinMode(BOOT_BUTTON_PIN,INPUT_PULLUP);pinMode(PWR_BUTTON_PIN,INPUT_PULLUP);
  bool stable[2]={true,true},raw[2]={true,true},armed[2]={false,false},held[2]={false,false};
  uint32_t changed[2]={0,0},pressed[2]={0,0};int pins[2]={BOOT_BUTTON_PIN,PWR_BUTTON_PIN};
  for(;;) {
    for(int i=0;i<2;i++) {
      bool high=digitalRead(pins[i]);uint32_t now=millis();
      if(high!=raw[i]){raw[i]=high;changed[i]=now;}
      if(now-changed[i]>=35 && high!=stable[i]) {
        stable[i]=high;
        if(!high){pressed[i]=now;held[i]=false;}
        else {if(armed[i] && !held[i] && now-pressed[i]>=35)buttonEvent(i==0,false);armed[i]=true;}
      }
      // Do not interpret the button used to power the board on as an app gesture.
      if(high && now-changed[i]>100) armed[i]=true;
      if(!high && armed[i] && !held[i] && now-pressed[i]>=2000){held[i]=true;buttonEvent(i==0,true);}
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}
int request(const char *path,const String &body,JsonDocument &output,bool pair=false) {
  NetworkClientSecure client;client.setCACert(TRUST_ROOTS);client.setHandshakeTimeout(8);
  HTTPClient http;http.setConnectTimeout(5000);http.setTimeout(8000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if(!http.begin(client,gateway+path))return -1;
  http.addHeader("Content-Type","application/json");if(!pair)http.addHeader("Authorization","Bearer "+deviceToken);
  int code=body.isEmpty()?http.GET():http.POST(body);
  if(code>0) {String response=http.getString();if(deserializeJson(output,response)!=DeserializationError::Ok)code=-2;}
  http.end();return code;
}
void acceptState(JsonDocument &doc) {
  if(!doc["state"]["tasks"].is<JsonArray>() || !doc["serverNow"].is<int64_t>())return;
  xSemaphoreTake(stateMutex,portMAX_DELAY);
  String browsing=(browseIndex>=0 && browseIndex<(int)tasks.size())?tasks[browseIndex].id:"";
  tasks.clear();for(JsonObject task:doc["state"]["tasks"].as<JsonArray>()) {
    int left=task["estimate"].as<int>()-task["done"].as<int>();
    if(left>0)tasks.push_back({task["id"].as<String>(),task["name"].as<String>(),left});
  }
  browseIndex=-1;for(size_t i=0;i<tasks.size();i++)if(tasks[i].id==browsing)browseIndex=i;
  auto timer=doc["state"]["timer"];
  selectedId=timer["taskId"]|"";timerMode=timer["mode"]|"focus";deadline=timer["deadline"]|int64_t(0);secondsRemaining=timer["remaining"]|1500;
  revision=doc["revision"].as<int64_t>();serverClock=doc["serverNow"].as<int64_t>();serverTick=millis();lastGood=millis();connected=true;
  statusText=deadline?"Focusing":(secondsRemaining<(timerMode=="focus"?1500:300)?"Paused":"Ready");if(timerMode=="break")statusText="Break";
  xSemaphoreGive(stateMutex);
}
void networkTask(void*) {
  uint32_t nextPoll=0;
  for(;;) {
    if(WiFi.status()!=WL_CONNECTED) {setStatus("Wi-Fi disconnected");xSemaphoreTake(stateMutex,portMAX_DELAY);connected=false;xSemaphoreGive(stateMutex);WiFi.reconnect();vTaskDelay(pdMS_TO_TICKS(5000));continue;}
    if(time(nullptr)<1700000000) {setStatus("Setting secure clock...");vTaskDelay(pdMS_TO_TICKS(1000));continue;}
    if(!pairingCode.isEmpty()) {
      JsonDocument body,result;body["pairingCode"]=pairingCode;body["token"]=deviceToken;String text;serializeJson(body,text);
      int code=request("/api/device/pair",text,result,true);
      if(code==200){prefs.remove("pair");pairingCode="";setStatus("Paired");}
      else {setStatus(code==401?"Pairing expired: use USB setup":"Pairing connection failed");vTaskDelay(pdMS_TO_TICKS(5000));continue;}
    }
    Action action;
    if(pendingCommand.isEmpty() && xQueueReceive(actionQueue,&action,0)==pdTRUE) {
      JsonDocument body;body["commandId"]=uuid();body["revision"]=action.revision;body["action"]["type"]=action.type;if(action.taskId[0])body["action"]["taskId"]=action.taskId;
      serializeJson(body,pendingCommand);
      // Persist before the first send. Reboots/timeouts resend these exact bytes.
      if(prefs.putString("pending",pendingCommand)==0){pendingCommand="";setStatus("Storage error: command cancelled");xSemaphoreTake(stateMutex,portMAX_DELAY);awaiting=false;xSemaphoreGive(stateMutex);}
    }
    if(!pendingCommand.isEmpty()) {
      JsonDocument result;int code=request("/api/device/command",pendingCommand,result);
      if(code==200 || code==409 || code==422 || code==401 || code==400) {
        acceptState(result);prefs.remove("pending");pendingCommand="";
        xSemaphoreTake(stateMutex,portMAX_DELAY);awaiting=false;if(code==401)connected=false;xSemaphoreGive(stateMutex);
        if(code!=200)setStatus(code==409?"Changed remotely: press again":code==401?"Device revoked: pair again":result["error"]|"Command rejected");
        nextPoll=millis()+5000;
      } else {setStatus("Retrying saved command...");vTaskDelay(pdMS_TO_TICKS(5000));continue;}
    }
    if((int32_t)(millis()-nextPoll)>=0) {
      JsonDocument result;int code=request("/api/device/state","",result);
      if(code==200)acceptState(result);else {xSemaphoreTake(stateMutex,portMAX_DELAY);connected=false;xSemaphoreGive(stateMutex);setStatus(code==401?"Device revoked: pair again":"Offline: cached timer");}
      nextPoll=millis()+5000;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
void renderScreen() {
  xSemaphoreTake(stateMutex,portMAX_DELAY);
  String name="Select a task",help="BOOT: next\nPWR: start / pause",status=statusText;
  if(configuring){name="Pomopomo setup";help="Use USB Serial\n115200 baud";}
  else if(browseIndex>=0 && browseIndex<(int)tasks.size()){name=tasks[browseIndex].name;help="BOOT: next\nPWR: select";status=String(tasks[browseIndex].left)+" pomos left";}
  else {for(auto &task:tasks)if(task.id==selectedId)name=task.name;if(timerMode=="break")name="Short break";}
  int secs=secondsRemaining;if(deadline>0)secs=max(int64_t(0),(deadline-serverClock-int64_t(uint32_t(millis()-serverTick))+999)/1000);
  // E-paper countdown is sampled every 30 seconds. Server timing stays exact.
  int shown=deadline>0?((secs+29)/30)*30:secs;char timerText[16];snprintf(timerText,sizeof(timerText),"%02d:%02d",shown/60,shown%60);
  if(deadline>0 && secs==0)status="Completing / syncing";
  String paint=name+timerText+status+help;
  xSemaphoreGive(stateMutex);
  if(paint==previousPaint || millis()-lastPaint<1200)return;
  previousPaint=paint;lastPaint=millis();
  lv_label_set_text(titleLabel,name.c_str());lv_label_set_text(timerLabel,configuring?"USB setup":timerText);lv_label_set_text(statusLabel,status.c_str());lv_label_set_text(helpLabel,help.c_str());
  lv_refr_now(nullptr);
}
void startNetwork() {
  gateway=prefs.getString("gateway","");deviceToken=prefs.getString("token","");pairingCode=prefs.getString("pair","");pendingCommand=prefs.getString("pending","");
  String ssid=prefs.getString("ssid","");
  if(ssid.isEmpty()||gateway.isEmpty()||deviceToken.isEmpty()){configuring=true;setStatus("Send setup JSON via Serial");return;}
  WiFi.mode(WIFI_STA);WiFi.begin(ssid.c_str(),prefs.getString("password","").c_str());configTime(0,0,"pool.ntp.org","time.google.com");
  awaiting=!pendingCommand.isEmpty();networkStarted=true;xTaskCreatePinnedToCore(networkTask,"pomo-network",16384,nullptr,1,nullptr,0);
}
void serialSetup() {
  static String line;
  while(Serial.available()) {
    char c=Serial.read();if(c=='\r')continue;if(c!='\n'){if(line.length()<2048)line+=c;continue;}
    JsonDocument doc;auto error=deserializeJson(doc,line);line="";
    if(error){Serial.println("Invalid JSON");continue;}
    if(doc["reset"].as<bool>()){prefs.clear();ESP.restart();}
    if(networkStarted){Serial.println("Send {\"reset\":true} first to change setup. Revoke the old pairing in the PWA.");continue;}
    String url=doc["gateway"]|"",pair=doc["pairingCode"]|"";
    if(!url.startsWith("https://")||url.indexOf('/',8)>=0||pair.length()!=32||!doc["ssid"].is<const char*>()){Serial.println("Expected ssid,password,https gateway origin,pairingCode");continue;}
    prefs.putString("ssid",doc["ssid"].as<String>());prefs.putString("password",doc["password"]|"");prefs.putString("gateway",url);prefs.putString("pair",pair);prefs.putString("token","pomo_"+randomHex(32));
    Serial.println("Configuration saved. Restarting. No credentials are printed.");delay(100);ESP.restart();
  }
}
void setup() {
  power.VBAT_POWER_ON();power.POWEER_EPD_ON();power.POWEER_Audio_OFF();
  Serial.begin(115200);prefs.begin("pomopomo",false);stateMutex=xSemaphoreCreateMutex();actionQueue=xQueueCreate(1,sizeof(Action));
  setupDisplay();startNetwork();xTaskCreatePinnedToCore(buttonsTask,"buttons",4096,nullptr,2,nullptr,1);
  Serial.println("Pomopomo V2. USB setup JSON: ssid, password, gateway, pairingCode. Never use the Sites service token here.");
}
void loop() {
  serialSetup();static uint32_t last=millis();uint32_t now=millis();lv_tick_inc(now-last);last=now;
  if(powerOff){setStatus("Power off");renderScreen();while(digitalRead(PWR_BUTTON_PIN)==LOW)delay(10);power.VBAT_POWER_OFF();esp_sleep_enable_ext0_wakeup(PWR_BUTTON_PIN,0);esp_deep_sleep_start();}
  renderScreen();delay(20);
}
