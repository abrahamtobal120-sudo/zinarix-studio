import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppEvent, Channel, OmniApi } from '../shared/api.js';
import { EVENT_CHANNEL } from '../shared/api.js';

const call =
  (channel: Channel) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

const api: OmniApi = {
  workspace: {
    current: call('workspace:current') as OmniApi['workspace']['current'],
    openDialog: call('workspace:openDialog') as OmniApi['workspace']['openDialog'],
    openPath: call('workspace:openPath') as OmniApi['workspace']['openPath'],
    close: call('workspace:close') as OmniApi['workspace']['close'],
    recent: call('workspace:recent') as OmniApi['workspace']['recent'],
    readDir: call('workspace:readDir') as OmniApi['workspace']['readDir'],
    readFile: call('workspace:readFile') as OmniApi['workspace']['readFile'],
    writeFile: call('workspace:writeFile') as OmniApi['workspace']['writeFile'],
    createFile: call('workspace:createFile') as OmniApi['workspace']['createFile'],
    createDir: call('workspace:createDir') as OmniApi['workspace']['createDir'],
    rename: call('workspace:rename') as OmniApi['workspace']['rename'],
    trash: call('workspace:trash') as OmniApi['workspace']['trash'],
    listFiles: call('workspace:listFiles') as OmniApi['workspace']['listFiles'],
    search: call('workspace:search') as OmniApi['workspace']['search'],
  },
  ai: {
    providers: call('ai:providers') as OmniApi['ai']['providers'],
    saveProvider: call('ai:saveProvider') as OmniApi['ai']['saveProvider'],
    removeProvider: call('ai:removeProvider') as OmniApi['ai']['removeProvider'],
    models: call('ai:models') as OmniApi['ai']['models'],
    settings: call('ai:settings') as OmniApi['ai']['settings'],
    setDefaultModel: call('ai:setDefaultModel') as OmniApi['ai']['setDefaultModel'],
    setRole: call('ai:setRole') as OmniApi['ai']['setRole'],
    usage: call('ai:usage') as OmniApi['ai']['usage'],
    setBudget: call('ai:setBudget') as OmniApi['ai']['setBudget'],
    setLocalOnly: call('ai:setLocalOnly') as OmniApi['ai']['setLocalOnly'],
    setTheme: call('ai:setTheme') as OmniApi['ai']['setTheme'],
    chat: call('ai:chat') as OmniApi['ai']['chat'],
    edit: call('ai:edit') as OmniApi['ai']['edit'],
    abort: call('ai:abort') as OmniApi['ai']['abort'],
    toolDecision: call('ai:toolDecision') as OmniApi['ai']['toolDecision'],
    revert: call('ai:revert') as OmniApi['ai']['revert'],
  },
  terminal: {
    create: call('terminal:create') as OmniApi['terminal']['create'],
    write: call('terminal:write') as OmniApi['terminal']['write'],
    resize: call('terminal:resize') as OmniApi['terminal']['resize'],
    kill: call('terminal:kill') as OmniApi['terminal']['kill'],
  },
  app: {
    openExternal: call('app:openExternal') as OmniApi['app']['openExternal'],
    quit: call('app:quit') as OmniApi['app']['quit'],
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    platform: process.platform,
  },
  on(listener) {
    const handler = (_e: unknown, ev: AppEvent) => listener(ev);
    ipcRenderer.on(EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('omni', api);
