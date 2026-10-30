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
    conversations: call('ai:conversations') as OmniApi['ai']['conversations'],
    conversation: call('ai:conversation') as OmniApi['ai']['conversation'],
    renameConversation: call('ai:renameConversation') as OmniApi['ai']['renameConversation'],
    deleteConversation: call('ai:deleteConversation') as OmniApi['ai']['deleteConversation'],
    exportConversation: call('ai:exportConversation') as OmniApi['ai']['exportConversation'],
    usage: call('ai:usage') as OmniApi['ai']['usage'],
    setBudget: call('ai:setBudget') as OmniApi['ai']['setBudget'],
    setLocalOnly: call('ai:setLocalOnly') as OmniApi['ai']['setLocalOnly'],
    setTheme: call('ai:setTheme') as OmniApi['ai']['setTheme'],
    chat: call('ai:chat') as OmniApi['ai']['chat'],
    edit: call('ai:edit') as OmniApi['ai']['edit'],
    abort: call('ai:abort') as OmniApi['ai']['abort'],
    toolDecision: call('ai:toolDecision') as OmniApi['ai']['toolDecision'],
    revert: call('ai:revert') as OmniApi['ai']['revert'],
    complete: call('ai:complete') as OmniApi['ai']['complete'],
    commitMessage: call('ai:commitMessage') as OmniApi['ai']['commitMessage'],
    rulesFile: call('ai:rulesFile') as OmniApi['ai']['rulesFile'],
    resetContext: call('ai:resetContext') as OmniApi['ai']['resetContext'],
  },
  git: {
    status: call('git:status') as OmniApi['git']['status'],
    init: call('git:init') as OmniApi['git']['init'],
    stage: call('git:stage') as OmniApi['git']['stage'],
    unstage: call('git:unstage') as OmniApi['git']['unstage'],
    discard: call('git:discard') as OmniApi['git']['discard'],
    diff: call('git:diff') as OmniApi['git']['diff'],
    commit: call('git:commit') as OmniApi['git']['commit'],
    log: call('git:log') as OmniApi['git']['log'],
    show: call('git:show') as OmniApi['git']['show'],
    branches: call('git:branches') as OmniApi['git']['branches'],
    checkout: call('git:checkout') as OmniApi['git']['checkout'],
    deleteBranch: call('git:deleteBranch') as OmniApi['git']['deleteBranch'],
    sync: call('git:sync') as OmniApi['git']['sync'],
    stash: call('git:stash') as OmniApi['git']['stash'],
    addRemote: call('git:addRemote') as OmniApi['git']['addRemote'],
  },
  github: {
    status: call('github:status') as OmniApi['github']['status'],
    repos: call('github:repos') as OmniApi['github']['repos'],
    clone: call('github:clone') as OmniApi['github']['clone'],
    publish: call('github:publish') as OmniApi['github']['publish'],
  },
  security: {
    scan: call('security:scan') as OmniApi['security']['scan'],
    scanAbort: call('security:scanAbort') as OmniApi['security']['scanAbort'],
    run: call('security:run') as OmniApi['security']['run'],
    saveReport: call('security:saveReport') as OmniApi['security']['saveReport'],
  },
  browser: {
    setBounds: call('browser:setBounds') as OmniApi['browser']['setBounds'],
    navigate: call('browser:navigate') as OmniApi['browser']['navigate'],
    back: call('browser:back') as OmniApi['browser']['back'],
    forward: call('browser:forward') as OmniApi['browser']['forward'],
    reload: call('browser:reload') as OmniApi['browser']['reload'],
    state: call('browser:state') as OmniApi['browser']['state'],
    home: call('browser:home') as OmniApi['browser']['home'],
    tabs: call('browser:tabs') as OmniApi['browser']['tabs'],
    selectTab: call('browser:selectTab') as OmniApi['browser']['selectTab'],
    closeTab: call('browser:closeTab') as OmniApi['browser']['closeTab'],
    newTab: call('browser:newTab') as OmniApi['browser']['newTab'],
  },
  terminal: {
    create: call('terminal:create') as OmniApi['terminal']['create'],
    write: call('terminal:write') as OmniApi['terminal']['write'],
    resize: call('terminal:resize') as OmniApi['terminal']['resize'],
    kill: call('terminal:kill') as OmniApi['terminal']['kill'],
  },
  app: {
    prefs: call('app:prefs') as OmniApi['app']['prefs'],
    setPrefs: call('app:setPrefs') as OmniApi['app']['setPrefs'],
    openExternal: call('app:openExternal') as OmniApi['app']['openExternal'],
    quit: call('app:quit') as OmniApi['app']['quit'],
    newWindow: call('app:newWindow') as OmniApi['app']['newWindow'],
    installUpdate: call('app:installUpdate') as OmniApi['app']['installUpdate'],
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    platform: process.platform,
  },
  license: {
    status: call('license:status') as OmniApi['license']['status'],
    activate: call('license:activate') as OmniApi['license']['activate'],
    remove: call('license:remove') as OmniApi['license']['remove'],
  },
  on(listener) {
    const handler = (_e: unknown, ev: AppEvent) => listener(ev);
    ipcRenderer.on(EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('omni', api);
