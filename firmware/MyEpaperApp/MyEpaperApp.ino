// Foundation: Waveshare 09_LVGL_V8_Test, approved by the owner.
// Target: ESP32-S3-ePaper-1.54 V2, non-touch. See ../../docs/EPAPER.md.
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <NetworkClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <lvgl.h>
#include <vector>
#include <time.h>
#include <esp_timer.h>
#include <esp_sleep.h>
#include <esp_wifi.h>
#include <esp_adc/adc_oneshot.h>
#include <esp_adc/adc_cali.h>
#include <esp_adc/adc_cali_scheme.h>
#include "user_config.h"
#include "battery_level.h"
#include "trust_roots.h"
#include "wifi_setup.h"
#include "wifi_setup_page.h"
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
volatile bool wifiSetupRequested = false, networkPaused = false;
WebServer setupServer(80);
DNSServer setupDns;
bool portalActive = false, portalConnecting = false, portalHandlersReady = false;
String setupSsid, setupPassword, setupToken, candidateSsid, candidatePassword, candidatePair;
String portalState = "idle", portalMessage;
uint32_t portalStarted = 0, candidateStarted = 0, restartAt = 0;
const char *DEFAULT_GATEWAY = "https://pomopomo-device-gateway.pomopomo-karti.workers.dev";
lv_obj_t *titleLabel, *timerLabel, *statusLabel, *helpLabel;
uint32_t lastPaint = 0; int partialCount = 0; String previousPaint;
lv_obj_t *batteryBody, *batteryFill, *batteryNub, *batteryLabel;
adc_oneshot_unit_handle_t batteryAdc; adc_cali_handle_t batteryCali; bool batteryReady = false;
int batteryPercent = -1;
const int BATTERY_BODY_W = 24, BATTERY_BODY_H = 12;

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
lv_obj_t *batteryBox(int x,int y,int w,int h,int border,bool filled) {
  lv_obj_t *obj=lv_obj_create(lv_scr_act());lv_obj_remove_style_all(obj);lv_obj_clear_flag(obj,LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_set_pos(obj,x,y);lv_obj_set_size(obj,w,h);lv_obj_set_style_border_width(obj,border,0);lv_obj_set_style_border_color(obj,lv_color_black(),0);
  lv_obj_set_style_bg_opa(obj,filled?LV_OPA_COVER:LV_OPA_TRANSP,0);lv_obj_set_style_bg_color(obj,lv_color_black(),0);return obj;
}
void createBatteryIndicator() {
  const int right=192,x=right-BATTERY_BODY_W-3,y=4;
  batteryBody=batteryBox(x,y,BATTERY_BODY_W,BATTERY_BODY_H,2,false);
  batteryNub=batteryBox(x+BATTERY_BODY_W,y+3,3,BATTERY_BODY_H-6,0,true);
  batteryFill=batteryBox(x+3,y+3,BATTERY_BODY_W-6,BATTERY_BODY_H-6,0,true);
  batteryLabel=lv_label_create(lv_scr_act());lv_obj_set_pos(batteryLabel,x-48,y-1);lv_obj_set_size(batteryLabel,44,16);
  lv_label_set_long_mode(batteryLabel,LV_LABEL_LONG_CLIP);lv_obj_set_style_text_align(batteryLabel,LV_TEXT_ALIGN_RIGHT,0);lv_obj_set_style_text_font(batteryLabel,&lv_font_montserrat_14,0);
}
void setupBattery() {
  adc_cali_curve_fitting_config_t cali={};cali.unit_id=ADC_UNIT_1;cali.atten=ADC_ATTEN_DB_12;cali.bitwidth=ADC_BITWIDTH_12;
  adc_oneshot_unit_init_cfg_t unit={};unit.unit_id=ADC_UNIT_1;
  adc_oneshot_chan_cfg_t channel={};channel.atten=ADC_ATTEN_DB_12;channel.bitwidth=ADC_BITWIDTH_12;
  batteryReady=adc_cali_create_scheme_curve_fitting(&cali,&batteryCali)==ESP_OK && adc_oneshot_new_unit(&unit,&batteryAdc)==ESP_OK && adc_oneshot_config_channel(batteryAdc,ADC_CHANNEL_3,&channel)==ESP_OK;
  if(!batteryReady)Serial.println("Battery ADC unavailable");
}
// Averaged ADC1 CH3 (GPIO4) sample every 30 seconds; -1 hides the indicator.
void updateBattery() {
  static uint32_t last=0;static bool first=true;
  if(!batteryReady || (!first && millis()-last<30000))return;
  first=false;last=millis();
  int total=0,count=0;
  for(int i=0;i<16;i++){int raw=0,mv=0;if(adc_oneshot_read(batteryAdc,ADC_CHANNEL_3,&raw)==ESP_OK && adc_cali_raw_to_voltage(batteryCali,raw,&mv)==ESP_OK){total+=mv;count++;}delay(2);}
  batteryPercent=count?batteryDisplayPercent(total/(float)count/1000.0f*BATTERY_DIVIDER):-1;
}
void drawBattery() {
  bool visible=batteryPercent>=0;
  lv_obj_t *parts[]={batteryBody,batteryNub,batteryFill,batteryLabel};
  for(auto part:parts){if(visible)lv_obj_clear_flag(part,LV_OBJ_FLAG_HIDDEN);else lv_obj_add_flag(part,LV_OBJ_FLAG_HIDDEN);}
  if(!visible)return;
  int inner=BATTERY_BODY_W-6,fill=(inner*batteryPercent+50)/100;if(batteryPercent>0&&fill<1)fill=1;
  lv_obj_set_width(batteryFill,fill);
  if(fill==0)lv_obj_add_flag(batteryFill,LV_OBJ_FLAG_HIDDEN);
  char text[8];snprintf(text,sizeof(text),"%d%%",batteryPercent);lv_label_set_text(batteryLabel,text);
}
void setupDisplay() {
  custom_lcd_spi_t config={};config.cs=EPD_CS_PIN;config.dc=EPD_DC_PIN;config.rst=EPD_RST_PIN;config.busy=EPD_BUSY_PIN;config.mosi=EPD_MOSI_PIN;config.scl=EPD_SCK_PIN;config.spi_host=EPD_SPI_NUM;config.buffer_len=5000;
  display=new epaper_driver_display(200,200,config);
  lv_init();static lv_disp_draw_buf_t buffer;static lv_disp_drv_t driver;
  auto pixels=(lv_color_t*)heap_caps_malloc(200*200*sizeof(lv_color_t),MALLOC_CAP_SPIRAM);
  if(!pixels){Serial.println("PSRAM unavailable: select OPI PSRAM");while(true)delay(1000);}
  lv_disp_draw_buf_init(&buffer,pixels,nullptr,200*200);lv_disp_drv_init(&driver);driver.hor_res=200;driver.ver_res=200;driver.draw_buf=&buffer;driver.flush_cb=flushDisplay;driver.full_refresh=1;lv_disp_drv_register(&driver);
  lv_obj_set_style_bg_color(lv_scr_act(),lv_color_white(),0);lv_obj_set_style_text_color(lv_scr_act(),lv_color_black(),0);
  createBatteryIndicator();
  titleLabel=label(22,42,&lv_font_montserrat_14);timerLabel=label(65,40,&lv_font_montserrat_28);statusLabel=label(110,40,&lv_font_montserrat_14);helpLabel=label(156,40,&lv_font_montserrat_14);
}
// Short-press actions are queued only against a fresh, acknowledged revision.
void buttonEvent(bool boot,bool longPress) {
  xSemaphoreTake(stateMutex,portMAX_DELAY);
  if (!boot && longPress) { powerOff=true; xSemaphoreGive(stateMutex); return; }
  if (wifiSetupRequested) { xSemaphoreGive(stateMutex); return; }
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
        else {if(armed[i] && !held[i] && now-pressed[i]>=35)buttonEvent(i==0, i==0 && now-pressed[i]>=2000);armed[i]=true;}
      }
      // Do not interpret the button used to power the board on as an app gesture.
      if(high && now-changed[i]>100) armed[i]=true;
      // Require a debounced press: a fresh raw edge still has the OLD press timestamp.
      if(!high && !stable[i] && armed[i] && !held[i] && now-pressed[i]>=(i==0?5000:2000)) {
        held[i]=true;
        if(i==0){wifiSetupRequested=true;} else buttonEvent(false,true);
      }
    }
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}
int request(const char *path,const String &body,JsonDocument &output,bool pair=false) {
  const uint32_t requestStarted = millis();
  NetworkClientSecure client;client.setCACert(TRUST_ROOTS);client.setHandshakeTimeout(8);
  HTTPClient http;http.setConnectTimeout(15000);http.setTimeout(8000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if(!http.begin(client,gateway+path))return -1;
  http.addHeader("Content-Type","application/json");if(!pair)http.addHeader("Authorization","Bearer "+deviceToken);
  int code=body.isEmpty()?http.GET():http.POST(body);
  if(code>0) {String response=http.getString();auto parsed=deserializeJson(output,response);if(parsed!=DeserializationError::Ok){Serial.printf("[sync] invalid JSON: HTTP %d, bytes %u, error %s\n",code,(unsigned)response.length(),parsed.c_str());code=-100;}}
  Serial.printf("[sync] %s code=%d ms=%lu wifi=%d rssi=%d heap=%u\n",path,code,(unsigned long)(millis()-requestStarted),(int)WiFi.status(),WiFi.RSSI(),ESP.getFreeHeap());
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
    if(wifiSetupRequested) { networkPaused=true; vTaskDelay(pdMS_TO_TICKS(100)); continue; }
    if(WiFi.status()!=WL_CONNECTED) {setStatus("Wi-Fi disconnected");xSemaphoreTake(stateMutex,portMAX_DELAY);connected=false;xSemaphoreGive(stateMutex);WiFi.reconnect();vTaskDelay(pdMS_TO_TICKS(5000));continue;}
    if(time(nullptr)<1700000000) {setStatus("Setting secure clock...");vTaskDelay(pdMS_TO_TICKS(1000));continue;}
    if(!pairingCode.isEmpty()) {
      JsonDocument body,result;body["pairingCode"]=pairingCode;body["token"]=deviceToken;String text;serializeJson(body,text);
      int code=request("/api/device/pair",text,result,true);
      if(code==200){prefs.remove("pair");pairingCode="";setStatus("Paired");}
      else {setStatus(code==401?"Pairing expired: hold BOOT":"Pairing connection failed");vTaskDelay(pdMS_TO_TICKS(5000));continue;}
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
  if(wifiSetupRequested) {
    name=portalActive?"Join Wi-Fi:\n"+setupSsid:"Opening Wi-Fi setup...";
    help=portalActive?"http://192.168.4.1":"Please wait";
    status=portalActive?"Password:\n"+setupPassword:"Finishing sync request";
  }
  else if(configuring){name="Pomopomo setup";help="Hold BOOT 5 sec\nfor Wi-Fi setup";}
  else if(browseIndex>=0 && browseIndex<(int)tasks.size()){name=tasks[browseIndex].name;help="BOOT: next\nPWR: select";status=String(tasks[browseIndex].left)+" pomos left";}
  else {for(auto &task:tasks)if(task.id==selectedId)name=task.name;if(timerMode=="break")name="Short break";}
  int secs=secondsRemaining;if(deadline>0)secs=max(int64_t(0),(deadline-serverClock-int64_t(uint32_t(millis()-serverTick))+999)/1000);
  // E-paper countdown is sampled every 30 seconds. Server timing stays exact.
  int shown=deadline>0?((secs+29)/30)*30:secs;char timerText[16];snprintf(timerText,sizeof(timerText),"%02d:%02d",shown/60,shown%60);
  if(!wifiSetupRequested && deadline>0 && secs==0)status="Completing / syncing";
  String timerDisplay=wifiSetupRequested?"Wi-Fi setup":configuring?"Setup":String(timerText);
  String paint=name+timerDisplay+status+help+"|"+String(batteryPercent);
  xSemaphoreGive(stateMutex);
  if(paint==previousPaint || millis()-lastPaint<1200)return;
  previousPaint=paint;lastPaint=millis();drawBattery();
  lv_label_set_text(titleLabel,name.c_str());lv_label_set_text(timerLabel,timerDisplay.c_str());lv_label_set_text(statusLabel,status.c_str());lv_label_set_text(helpLabel,help.c_str());
  lv_refr_now(nullptr);
}
// This local portal runs only after a physical request (or first boot).
// Network writes are paused before Preferences or Wi-Fi configuration is changed.
bool authorizedSetup() {
  if (!portalActive || setupServer.header("X-Setup-Token") != setupToken) {
    setupServer.send(403,"application/json","{\"error\":\"Reopen the setup page.\"}"); return false;
  }
  setupServer.sendHeader("Cache-Control","no-store");return true;
}
void configurePortalRoutes() {
  if(portalHandlersReady)return;
  portalHandlersReady=true;
  const char *headers[]={"X-Setup-Token"};setupServer.collectHeaders(headers,1);
  setupServer.on("/",HTTP_GET,[](){
    if(setupServer.hostHeader()!="192.168.4.1") {setupServer.sendHeader("Location","http://192.168.4.1/",true);setupServer.send(302,"text/plain","");return;}
    String page=FPSTR(WIFI_SETUP_PAGE);page.replace("{{SETUP_TOKEN}}",setupToken);
    setupServer.sendHeader("Cache-Control","no-store");
    setupServer.sendHeader("Referrer-Policy","no-referrer");
    setupServer.sendHeader("X-Content-Type-Options","nosniff");
    setupServer.send(200,"text/html; charset=utf-8",page);
  });
  setupServer.on("/status",HTTP_GET,[](){
    if(!authorizedSetup())return;
    JsonDocument doc;doc["state"]=portalState;doc["message"]=portalMessage;doc["paired"]=!deviceToken.isEmpty();
    String body;serializeJson(doc,body);setupServer.send(200,"application/json",body);
  });
  setupServer.on("/networks",HTTP_GET,[](){
    if(!authorizedSetup())return;
    JsonDocument doc;int count=WiFi.scanComplete();
    if(portalConnecting || count==WIFI_SCAN_RUNNING){doc["scanning"]=true;}
    else if(count<0){WiFi.scanNetworks(true,false);doc["scanning"]=true;}
    else {
      doc["scanning"]=false;auto list=doc["networks"].to<JsonArray>();
      // No network names are inserted as HTML; the phone uses text-only options.
      for(int i=0;i<count && i<40;i++) {
        String name=WiFi.SSID(i);if(name.isEmpty())continue;
        bool duplicate=false;for(JsonObject entry:list)if(entry["ssid"].as<String>()==name){duplicate=true;break;}
        if(duplicate)continue;
        auto entry=list.add<JsonObject>();entry["ssid"]=name;entry["secure"]=WiFi.encryptionType(i)!=WIFI_AUTH_OPEN;
      }
    }
    String body;serializeJson(doc,body);setupServer.send(200,"application/json",body);
  });
  setupServer.on("/connect",HTTP_POST,[](){
    if(!authorizedSetup())return;
    if(portalConnecting || restartAt){setupServer.send(409,"application/json","{\"error\":\"A connection is already in progress.\"}");return;}
    JsonDocument doc;
    if(setupServer.arg("plain").length()>2048 || deserializeJson(doc,setupServer.arg("plain"))!=DeserializationError::Ok || !doc["ssid"].is<String>() || !doc["password"].is<String>()){
      setupServer.send(400,"application/json","{\"error\":\"Invalid Wi-Fi settings.\"}");return;
    }
    String ssid=doc["ssid"].as<String>(),password=doc["password"].as<String>(),pair=doc["pairingCode"]|"";pair.toLowerCase();
    String error=validateWifiSetup(ssid,password,pair,!deviceToken.isEmpty());
    if(!error.isEmpty()){JsonDocument result;result["error"]=error;String body;serializeJson(result,body);setupServer.send(400,"application/json",body);return;}
    candidateSsid=ssid;candidatePassword=password;candidatePair=pair;
    portalConnecting=true;portalState="connecting";portalMessage="Connecting to Wi-Fi...";candidateStarted=millis();
    setupServer.send(202,"application/json","{\"connecting\":true}");
    // Stop a background scan before initiating association.
    esp_wifi_scan_stop();WiFi.scanDelete();WiFi.disconnect(false,false);
    WiFi.begin(candidateSsid.c_str(),candidatePassword.c_str());
  });
  setupServer.on("/cancel",HTTP_POST,[](){
    if(!authorizedSetup())return;
    setupServer.send(200,"application/json","{\"cancelled\":true}");restartAt=millis()+1500;
  });
  setupServer.onNotFound([](){setupServer.sendHeader("Location","http://192.168.4.1/",true);setupServer.send(302,"text/plain","");});
}
void beginWifiPortal() {
  setupSsid="Pomopomo-Setup-"+String((uint16_t)ESP.getEfuseMac(),HEX);setupPassword=randomHex(6);setupToken=randomHex(16);
  WiFi.persistent(false);WiFi.setAutoReconnect(false);WiFi.mode(WIFI_AP_STA);
  IPAddress ip(192,168,4,1);WiFi.softAPConfig(ip,ip,IPAddress(255,255,255,0));
  if(!WiFi.softAP(setupSsid.c_str(),setupPassword.c_str(),1,false,2)) {setStatus("Setup could not start; restart");Serial.println("[wifi] Setup AP failed");return;}
  setupDns.start(53,"*",ip);configurePortalRoutes();setupServer.begin();portalStarted=millis();portalActive=true;
  WiFi.scanNetworks(true,false);
  Serial.println("[wifi] Phone setup ready at http://192.168.4.1; network password is on the screen.");
}
void handleWifiPortal() {
  if(wifiSetupRequested && !portalActive && (networkPaused || !networkStarted))beginWifiPortal();
  if(!portalActive)return;
  setupDns.processNextRequest();setupServer.handleClient();
  if(portalConnecting) {
    if(millis()-candidateStarted>1000 && WiFi.status()==WL_CONNECTED && WiFi.SSID()==candidateSsid) {
      JsonDocument wifi;wifi["ssid"]=candidateSsid;wifi["password"]=candidatePassword;String saved;serializeJson(wifi,saved);
      bool stored=prefs.putString("wifi",saved)>0;
      if(stored && !candidatePair.isEmpty()) {
        // Only an explicit new pairing code changes account credentials.
        if(deviceToken.isEmpty()) {deviceToken="pomo_"+randomHex(32);stored=prefs.putString("token",deviceToken)>0;}
        stored=stored && prefs.putString("pair",candidatePair)>0;
        if(gateway.isEmpty())stored=stored && prefs.putString("gateway",DEFAULT_GATEWAY)>0;
      }
      candidatePassword="";candidatePair="";portalConnecting=false;
      if(stored){portalState="connected";portalMessage="Connected. Restarting...";restartAt=millis()+7000;Serial.println("[wifi] New Wi-Fi verified and saved; account pairing retained.");}
      else {portalState="failed";portalMessage="Could not save settings. Please try again.";}
    } else if(millis()-candidateStarted>30000) {
      WiFi.disconnect(false,false);candidatePassword="";candidatePair="";portalConnecting=false;
      portalState="failed";portalMessage="Could not connect. Check the password, 2.4 GHz network, and signal. Your saved settings were kept.";
      Serial.println("[wifi] Candidate connection failed; saved settings retained.");
    }
  }
  if((restartAt && (int32_t)(millis()-restartAt)>=0) || millis()-portalStarted>600000) {setupServer.stop();setupDns.stop();WiFi.softAPdisconnect(true);ESP.restart();}
}
void startNetwork() {
  gateway=prefs.getString("gateway","");deviceToken=prefs.getString("token","");pairingCode=prefs.getString("pair","");pendingCommand=prefs.getString("pending","");
  String ssid=prefs.getString("ssid","");
  String password=prefs.getString("password","");
  JsonDocument savedWifi;
  if(deserializeJson(savedWifi,prefs.getString("wifi",""))==DeserializationError::Ok) {ssid=savedWifi["ssid"].as<String>();password=savedWifi["password"].as<String>();}
  if(ssid.isEmpty()||gateway.isEmpty()||deviceToken.isEmpty()){configuring=true;wifiSetupRequested=true;networkPaused=true;return;}
  WiFi.persistent(false);WiFi.mode(WIFI_STA);WiFi.begin(ssid.c_str(),password.c_str());configTime(0,0,"pool.ntp.org","time.google.com");
  awaiting=!pendingCommand.isEmpty();networkStarted=true;xTaskCreatePinnedToCore(networkTask,"pomo-network",16384,nullptr,1,nullptr,0);
}
void serialSetup() {
  static String line;
  while(Serial.available()) {
    char c=Serial.read();if(c=='\r')continue;if(c!='\n'){if(line.length()<2048)line+=c;continue;}
    JsonDocument doc;auto error=deserializeJson(doc,line);line="";
    if(error){Serial.println("Invalid JSON");continue;}
    if(doc["wifiSetup"].as<bool>()){wifiSetupRequested=true;Serial.println("Wi-Fi setup requested; see device screen.");continue;}
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
  setupDisplay();setupBattery();updateBattery();startNetwork();xTaskCreatePinnedToCore(buttonsTask,"buttons",4096,nullptr,2,nullptr,1);
  Serial.println("Pomopomo V2. USB setup JSON: ssid, password, gateway, pairingCode. Never use the Sites service token here.");
}
void loop() {
  serialSetup();handleWifiPortal();static uint32_t last=millis();uint32_t now=millis();lv_tick_inc(now-last);last=now;
  if(powerOff){setStatus("Power off");renderScreen();while(digitalRead(PWR_BUTTON_PIN)==LOW)delay(10);power.VBAT_POWER_OFF();esp_sleep_enable_ext0_wakeup(PWR_BUTTON_PIN,0);esp_deep_sleep_start();}
  updateBattery();renderScreen();delay(20);
}
