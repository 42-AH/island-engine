package islandengine {
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.Stage;
    import flash.external.ExternalInterface;
    import flash.events.Event;
    import flash.geom.Point;
    import flash.geom.Rectangle;
    import flash.text.TextField;
    import flash.utils.getQualifiedClassName;
    import flash.utils.setInterval;
    import flash.utils.Dictionary;
    import engine.components.Display;
    import engine.components.Spatial;
    import engine.components.Motion;
    public class LiveEdit {
        private static var instance:LiveEdit;
        private var api:Object;
        private var stage:Stage;
        private var nodes:Object = {};
        private var identities:Dictionary = new Dictionary(true);
        private var nextIdentity:uint = 1;
        private var originals:Dictionary = new Dictionary(true);
        private var rules:Array = [];
        private var applied:Dictionary = new Dictionary(true);
        private var active:Boolean = false;
        private var room:String = "";
        private var appliedRoom:String = "";
        public static function start(shell:Object, view:Stage):void {
            if (!instance && view) instance = new LiveEdit(shell, view);
        }
        public function LiveEdit(shell:Object, view:Stage) {
            api=shell;stage=view;
            if(ExternalInterface.available) {
                ExternalInterface.addCallback("islandengineInspect",snapshot);
                ExternalInterface.addCallback("islandengineEdit",edit);
                ExternalInterface.addCallback("islandengineEditRules",setRules);
                setInterval(applyRules,250);
                stage.addEventListener(Event.EXIT_FRAME,holdEdits);
                ExternalInterface.call("islandengineInspectorReady");
            }
        }
        private function roomKey():String {
            return api.currentScene ? getQualifiedClassName(api.currentScene) : "loading";
        }
        private function segment(d:DisplayObject,index:int):String {
            var name:String=d.name;
            if(name.indexOf("instance")==0 && !isNaN(Number(name.substr(8))))name=getQualifiedClassName(d);
            return encodeURIComponent(name)+"~"+encodeURIComponent(getQualifiedClassName(d));
        }
        private function walk(d:DisplayObject,path:String,rows:Array,visible:Boolean,depth:int):void {
            nodes[path]=d;
            if(!identities[d])identities[d]=nextIdentity++;
            var shown:Boolean=visible&&d.visible&&d.alpha>0;
            if(rows && d!==stage) {
                var b:Rectangle=d.getBounds(stage);
                var origin:Point=d.localToGlobal(new Point());
                var source:String="";
                try{source=d.loaderInfo.url;}catch(e:Error){}
                rows.push({uid:identities[d],path:path,name:d.name,kind:getQualifiedClassName(d),depth:depth,left:b.x,top:b.y,width:b.width,height:b.height,
                    x:d.x,y:d.y,originX:origin.x,originY:origin.y,scaleX:d.scaleX,scaleY:d.scaleY,rotation:d.rotation,alpha:d.alpha,visible:d.visible,shown:shown,
                    text:d is TextField?TextField(d).text:null,source:source});
            }
            var container:DisplayObjectContainer=d as DisplayObjectContainer;
            var counts:Object={};
            if(container)for(var i:int=0;i<container.numChildren;i++) {
                var child:DisplayObject=container.getChildAt(i);
                var key:String=segment(child,i);var ordinal:int=counts[key]?counts[key]:0;counts[key]=ordinal+1;
                walk(child,path+"/"+key+"["+ordinal+"]",rows,shown,depth+1);
            }
        }
        public function snapshot():Object {
            checkRoom();
            room=roomKey();nodes={};var rows:Array=[];
            walk(stage,"stage",rows,true,0);
            return {room:room,ready:api.currentScene && api.currentScene.isReady,width:stage.stageWidth,height:stage.stageHeight,objects:rows};
        }
        private function values(d:DisplayObject):Object {
            var v:Object={x:d.x,y:d.y,scaleX:d.scaleX,scaleY:d.scaleY,rotation:d.rotation,alpha:d.alpha,visible:d.visible};
            if(d is TextField)v.text=TextField(d).text;
            return v;
        }
        private function assign(d:DisplayObject,v:Object):void {
            if(!originals[d])originals[d]={};
            var before:Object=values(d);
            var entity:Object=api.currentScene?api.currentScene.getEntityById(d.name):null;
            if(entity && (!entity.get(Display) || entity.get(Display).displayObject!==d))entity=null;
            for(var key:String in v) {
                if(!originals[d].hasOwnProperty(key) && before.hasOwnProperty(key))originals[d][key]=before[key];
                if(key=="text" && d is TextField)TextField(d).text=String(v[key]);
                else if(key=="visible") { d.visible=Boolean(v[key]);if(entity)entity.get(Display).visible=d.visible; }
                else if(key=="x"||key=="y"||key=="scaleX"||key=="scaleY"||key=="rotation"||key=="alpha") {
                    var n:Number=Number(v[key]);if(isNaN(n)||!isFinite(n))continue;
                    d[key]=n;
                    if(entity && key=="alpha")entity.get(Display).alpha=n;
                    if(entity) {
                        var spatial:Spatial=entity.get(Spatial);
                        if(spatial && key!="alpha")spatial[key]=n;
                        var motion:Motion=entity.get(Motion);
                        if(motion && (key=="x"||key=="y"))motion[key]=n;
                    }
                }
            }
        }
        public function edit(expectedRoom:String,path:String,v:Object,expectedId:Object=null):Object {
            if(expectedRoom!=roomKey())return {error:"The room changed. Select the object again."};
            nodes={};walk(stage,"stage",null,true,0);
            var d:DisplayObject=nodes[path];
            if(expectedId!=null && d && String(identities[d])!=String(expectedId))return {error:"This object changed. Select it again."};
            if(!d || !d.stage)return {error:"This object is no longer on stage."};
            if(v && v.dragX!=null) {
                var origin:Point=d.parent.globalToLocal(new Point(Number(v.dragX),Number(v.dragY)));
                v={x:origin.x,y:origin.y};
            }
            if(!v) { if(originals[d])assign(d,originals[d]); }
            else {
                assign(d,v);
                if(!applied[d])applied[d]={};
                for(var key:String in v)applied[d][key]=v[key];
            }
            return {values:values(d)};
        }
        public function setRules(next:Array):Boolean {
            for(var d:Object in originals)if(d is DisplayObject && DisplayObject(d).stage)assign(DisplayObject(d),originals[d]);
            rules=next?next:[];applied=new Dictionary(true);applyRules();return true;
        }
        private function applyRules():void {
            checkRoom();
            if(!rules.length)return;
            nodes={};walk(stage,"stage",null,true,0);
            var current:String=roomKey();
            for each(var rule:Object in rules)if(rule.room==current) {
                var d:DisplayObject=nodes[rule.path];
                if(d && !applied[d]){assign(d,rule.values);applied[d]=rule.values;}
            }
        }
        private function holdEdits(event:Event):void {
            checkRoom();
            for(var d:Object in applied)if(d is DisplayObject && DisplayObject(d).stage)assign(DisplayObject(d),applied[d]);
        }
        private function checkRoom():void {
            var current:String=roomKey();
            if(current==appliedRoom)return;
            for(var d:Object in originals)if(d is DisplayObject && DisplayObject(d).stage)assign(DisplayObject(d),originals[d]);
            originals=new Dictionary(true);applied=new Dictionary(true);appliedRoom=current;
        }
    }
}
