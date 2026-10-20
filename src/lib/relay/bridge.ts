export const BRIDGE_SCRIPT = `(function(){
  var PREFIX_RE=/^(\\/hds-[a-z0-9]+-\\d+-[a-z0-9]+)/i;
  function prefix(){var m=location.pathname.match(PREFIX_RE);return m?m[1]:"";}
  function upstream(){
    var m=location.pathname.match(/\\/relay\\/(https?)\\/([^/]+)(\\/.*)?$/i);
    if(!m)return location.href;
    return m[1].toLowerCase()+"://"+m[2]+(m[3]||"/")+location.search;
  }
  function hostToken(host){return "nl_"+host.toLowerCase().replace(/[^a-z0-9.-]/g,"_")+"_";}
  function skip(v){return !v||v.charAt(0)==="#"||v.charAt(0)==="?"||/^(data|blob|javascript|mailto|tel|about|sms):/i.test(v);}
  function needs(v){return v.charAt(0)==="/"||/^https?:/i.test(v);}
  function toProxy(input){
    if(input==null)return input;
    var s=String(input).trim();
    if(skip(s)||!needs(s))return input;
    var pre=prefix();
    var relayAt=s.indexOf("/relay/http");
    if(relayAt!==-1&&s.charAt(0)==="/"){
      var at=s.indexOf("/relay/");
      if(pre&&s.indexOf(pre+"/relay/")===0)return s;
      return pre+s.slice(at);
    }
    var abs;
    try{abs=new URL(s,upstream());}catch(e){return input;}
    if(abs.origin===location.origin){
      var path=abs.pathname;
      var cut=path.indexOf("/relay/");
      if(cut!==-1&&/\\/relay\\/https?/i.test(path))return pre+path.slice(cut)+abs.search+abs.hash;
      var up;
      try{up=new URL(upstream());}catch(e){return input;}
      return pre+"/relay/"+up.protocol.replace(":","")+"/"+up.host+path+abs.search+abs.hash;
    }
    if(abs.protocol!=="http:"&&abs.protocol!=="https:")return input;
    return pre+"/relay/"+abs.protocol.replace(":","")+"/"+abs.host+abs.pathname+abs.search+abs.hash;
  }
  try{
    Object.defineProperty(window,"top",{configurable:true,get:function(){return window;}});
    Object.defineProperty(window,"parent",{configurable:true,get:function(){return window;}});
  }catch(e){}
  if(navigator.serviceWorker&&navigator.serviceWorker.register){
    navigator.serviceWorker.register=function(){return Promise.reject(new Error("disabled"));};
  }
  var ofetch=window.fetch;
  if(ofetch){
    window.fetch=function(input,init){
      try{
        if(typeof input==="string"||input instanceof URL)return ofetch.call(this,toProxy(String(input)),init);
        if(input&&input.url)return ofetch.call(this,new Request(toProxy(input.url),input),init);
      }catch(e){}
      return ofetch.call(this,input,init);
    };
  }
  var xhr=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url){
    var args=Array.prototype.slice.call(arguments);
    if(args.length>1)args[1]=toProxy(url);
    return xhr.apply(this,args);
  };
  var push=history.pushState.bind(history);
  history.pushState=function(state,title,url){return push(state,title,url==null?url:toProxy(String(url)));};
  var replace=history.replaceState.bind(history);
  history.replaceState=function(state,title,url){return replace(state,title,url==null?url:toProxy(String(url)));};
  try{
    var assign=location.assign.bind(location);
    location.assign=function(url){return assign(toProxy(String(url)));};
    var repl=location.replace.bind(location);
    location.replace=function(url){return repl(toProxy(String(url)));};
  }catch(e){}
  function hookProp(proto,prop){
    if(!proto)return;
    var desc=Object.getOwnPropertyDescriptor(proto,prop);
    if(!desc||!desc.set||!desc.get)return;
    Object.defineProperty(proto,prop,{configurable:true,enumerable:desc.enumerable,get:function(){return desc.get.call(this);},set:function(v){desc.set.call(this,toProxy(v));}});
  }
  hookProp(window.HTMLImageElement&&HTMLImageElement.prototype,"src");
  hookProp(window.HTMLScriptElement&&HTMLScriptElement.prototype,"src");
  hookProp(window.HTMLIFrameElement&&HTMLIFrameElement.prototype,"src");
  hookProp(window.HTMLSourceElement&&HTMLSourceElement.prototype,"src");
  hookProp(window.HTMLMediaElement&&HTMLMediaElement.prototype,"src");
  hookProp(window.HTMLEmbedElement&&HTMLEmbedElement.prototype,"src");
  hookProp(window.HTMLObjectElement&&HTMLObjectElement.prototype,"data");
  hookProp(window.HTMLLinkElement&&HTMLLinkElement.prototype,"href");
  hookProp(window.HTMLAnchorElement&&HTMLAnchorElement.prototype,"href");
  hookProp(window.HTMLFormElement&&HTMLFormElement.prototype,"action");
  var setAttr=Element.prototype.setAttribute;
  Element.prototype.setAttribute=function(name,value){
    var n=String(name).toLowerCase();
    if(n==="integrity"||n==="nonce"||n==="ping")return;
    if(n==="src"||n==="href"||n==="action"||n==="poster"||n==="formaction"||n==="data"||n==="data-src"||n==="data-href"||n==="xlink:href")value=toProxy(value);
    if(n==="target"&&(value==="_top"||value==="_parent"))value="_self";
    return setAttr.call(this,name,value);
  };
  if(window.Worker){
    var NativeWorker=window.Worker;
    window.Worker=function(url,opts){return new NativeWorker(toProxy(String(url)),opts);};
  }
  if(window.EventSource){
    var NativeES=window.EventSource;
    window.EventSource=function(url,opts){return new NativeES(toProxy(String(url)),opts);};
  }
  var nativeOpen=window.open;
  if(nativeOpen){
    window.open=function(){
      var args=Array.prototype.slice.call(arguments);
      if(args.length)args[0]=toProxy(args[0]);
      return nativeOpen.apply(window,args);
    };
  }
  try{
    var cookieDesc=Object.getOwnPropertyDescriptor(Document.prototype,"cookie");
    if(cookieDesc&&cookieDesc.get&&cookieDesc.set){
      Object.defineProperty(document,"cookie",{configurable:true,get:function(){
        var raw=cookieDesc.get.call(document)||"";
        var token;
        try{token=hostToken(new URL(upstream()).host);}catch(e){return "";}
        return raw.split(";").map(function(part){
          var t=part.trim();
          var i=t.indexOf("=");
          if(i<1||t.slice(0,i).indexOf(token)!==0)return "";
          return t.slice(i===0?0:token.length);
        }).filter(Boolean).join("; ");
      },set:function(v){
        var s=String(v);
        var bits=s.split(";");
        var nv=bits[0]||"";
        var eq=nv.indexOf("=");
        if(eq<1)return;
        var name=nv.slice(0,eq).trim();
        var value=nv.slice(eq+1).trim();
        var up;
        try{up=new URL(upstream());}catch(e){return;}
        var path="/";
        var maxAge="";
        var expires="";
        for(var i=1;i<bits.length;i++){
          var piece=bits[i].trim();
          var key=piece.split("=")[0].trim().toLowerCase();
          var attr=piece.slice(piece.indexOf("=")+1).trim();
          if(key==="path"&&attr)path=attr;
          else if(key==="max-age")maxAge=attr;
          else if(key==="expires")expires=attr;
        }
        var scoped="/relay/"+up.protocol.replace(":","")+"/"+up.host+(path.charAt(0)==="/"?path:"/"+path);
        if(path==="/"&&scoped.charAt(scoped.length-1)!=="/")scoped+="/";
        var out=hostToken(up.host)+name+"="+value+"; Path="+prefix()+scoped+"; SameSite=Lax";
        if(maxAge)out+="; Max-Age="+maxAge;
        else if(expires)out+="; Expires="+expires;
        cookieDesc.set.call(document,out);
      }});
    }
  }catch(e){}
})();`;
