import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
if(process.platform!=='win32')throw new Error('A compilação nativa de teste precisa ser executada no Windows.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=process.env.CARGO_TARGET_DIR ?? path.join(os.homedir(),'AppData','Local','Deck26','build-target');
const result=spawnSync(process.execPath,[path.join(root,'node_modules','@tauri-apps','cli','tauri.js'),'build','--no-bundle','--config','src-tauri/tauri.test.conf.json'],{
  cwd:path.join(root,'apps','desktop'),stdio:'inherit',env:{...process.env,
    Path:path.join(os.homedir(),'.cargo','bin')+';'+process.env.Path,
    CARGO_TARGET_DIR:target,VITE_LOCAL_API_URL:'http://127.0.0.1:4700',VITE_DECK26_TEST_MODE:'true'
  }
});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
console.log('Executável de teste: '+path.join(target,'release','deck26-desktop.exe'));
