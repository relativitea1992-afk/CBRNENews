import { checkAllModels, geminiGenerate } from './lib/gemini-client';
checkAllModels().then(console.log);
geminiGenerate({ contents: 'test' }).catch(e => console.error(e));