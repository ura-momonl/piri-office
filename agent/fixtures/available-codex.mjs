// Offline app-server protocol fixture: a real child process, never a model call.
import {createInterface} from 'node:readline';
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
  const message=JSON.parse(line),{id,method}=message;
  if(id===undefined)return;
  if(method==='thread/start' || method==='thread/resume')send({id,result:{thread:{id:'available-thread',model:'offline-fixture'},model:'offline-fixture',sandbox:{type:'workspaceWrite'}}});
  else if(method==='turn/start'){
    send({id,result:{turn:{id:'available-turn'}}});
    setTimeout(()=>{
      send({method:'item/completed',params:{threadId:'available-thread',turnId:'available-turn',item:{id:'reply',type:'agentMessage',text:'原生进程已完成：无需其他订阅助手。'}}});
      send({method:'turn/completed',params:{threadId:'available-thread',turn:{id:'available-turn',status:'completed'}}});
    },25);
  }else send({id,result:{}});
});
