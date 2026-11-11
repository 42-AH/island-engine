package islandengine {
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.Stage;
    import flash.display.BitmapData;
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
        private var bitmapBounds:Dictionary = new Dictionary(true);
        private var readOnlyNodes:Dictionary = new Dictionary(true);
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
            describeEntities(rows);
            return {room:room,ready:api.currentScene && api.currentScene.isReady,width:stage.stageWidth,height:stage.stageHeight,objects:rows};
        }
        private function categoryFor(kind:String):String {
            if(kind=="Character" || kind=="npc")return "characters";
            if(kind=="Item" || kind=="item")return "items";
            if(kind=="Door" || kind=="door")return "doors";
            if(kind=="Platform" || kind=="PlatformRebound" || kind=="platform")return "platforms";
            if(kind=="Wall" || kind=="Ceiling" || kind=="wall")return "walls";
            if(kind=="Climb" || kind=="climb")return "climbs";
            if(kind=="Water" || kind=="water")return "water";
            if(kind=="Hazard" || kind=="hazard")return "hazards";
            if(kind=="Bounce" || kind=="WireBounce" || kind=="bounce")return "bounce";
            if(kind=="MovingHit" || kind=="movingPlatform")return "movingPlatforms";
            if(kind=="Zone" || kind=="SceneInteraction" || kind=="trigger")return "triggers";
            if(kind=="switch")return "switches";
            if(kind=="custom")return "custom";
            return "";
        }
        private function categoryPriority(category:String):int {
            if(category=="characters")return 5;
            if(category=="items" || category=="doors")return 4;
            if(category=="movingPlatforms")return 3;
            if(category=="triggers")return 1;
            return category?2:0;
        }
        private function sceneEntity(entity:Object):Boolean {
            var group:Object=entity.group;
            while(group) {
                if(group===api.currentScene)return true;
                group=group.parent;
            }
            return false;
        }
        private function worldBounds(container:DisplayObject,b:Rectangle):Rectangle {
            var points:Array=[new Point(b.left,b.top),new Point(b.right,b.top),new Point(b.right,b.bottom),new Point(b.left,b.bottom)];
            var result:Rectangle=null;
            for each(var p:Point in points) {
                p=container.localToGlobal(p);
                if(!result)result=new Rectangle(p.x,p.y,0,0);
                else {
                    var right:Number=Math.max(result.right,p.x);var bottom:Number=Math.max(result.bottom,p.y);
                    result.x=Math.min(result.x,p.x);result.y=Math.min(result.y,p.y);
                    result.width=right-result.x;result.height=bottom-result.y;
                }
            }
            return result;
        }
        private function collisionRow(rows:Array,entity:Object,id:String,category:String,kind:String,b:Rectangle,key:String):void {
            if(!b || b.width<=0 || b.height<=0)return;
            if(!identities[entity])identities[entity]=nextIdentity++;
            rows.push({uid:"collision-"+identities[entity]+"-"+key,path:"stage/collision/"+encodeURIComponent(id)+"~"+key,name:id,
                kind:kind+" collision",category:category,readOnly:true,depth:2,left:b.x,top:b.y,width:b.width,height:b.height,
                x:b.x,y:b.y,originX:b.x,originY:b.y,scaleX:1,scaleY:1,rotation:0,alpha:1,visible:false,shown:true,
                text:null,source:"Collision bounds"});
        }
        private function cacheCollisionBounds(bitmap:BitmapData,collisions:Array,group:Object):Object {
            var cache:Object=bitmapBounds[bitmap];
            if(!cache)cache={};
            var wanted:Object={};var missing:Boolean=false;
            for each(var collision:Object in collisions)if(collision.entity.group===group) {
                var key:String=String(uint(collision.color)&0xffffff);
                wanted[key]=true;
                if(!cache.hasOwnProperty(key))missing=true;
            }
            if(!missing)return cache;
            var width:int=bitmap.width;var height:int=bitmap.height;var total:int=width*height;
            var samples:Vector.<uint> = null;
            try{samples=bitmap.getVector(bitmap.rect);}catch(error:Error){}
            if(!samples || samples.length!=total) {
                samples=new Vector.<uint>(total,true);
                for(var py:int=0;py<height;py++)for(var px:int=0;px<width;px++)samples[py*width+px]=bitmap.getPixel(px,py);
            }
            var seen:Vector.<Boolean> = new Vector.<Boolean>(total,true);
            var pending:Vector.<int> = new Vector.<int>();
            for(key in wanted)cache[key]=[];
            // Each connected patch gets its own outline. A shared collision color
            // can describe several rooftops or lamp posts spread across a room.
            for(var index:int=0;index<total;index++) {
                if(seen[index])continue;
                var color:uint=samples[index]&0xffffff;
                key=String(color);
                if(!wanted.hasOwnProperty(key))continue;
                pending.length=0;pending.push(index);seen[index]=true;
                var left:int=index%width;var top:int=int(index/width);var right:int=left;var bottom:int=top;
                var cursor:int=0;
                while(cursor<pending.length) {
                    var current:int=pending[cursor++];var x:int=current%width;var y:int=int(current/width);
                    if(x<left)left=x;if(x>right)right=x;if(y<top)top=y;if(y>bottom)bottom=y;
                    for(var dy:int=-1;dy<=1;dy++)for(var dx:int=-1;dx<=1;dx++) {
                        if(dx==0 && dy==0)continue;
                        var nx:int=x+dx;var ny:int=y+dy;
                        if(nx<0 || nx>=width || ny<0 || ny>=height)continue;
                        var neighbor:int=ny*width+nx;
                        if(!seen[neighbor] && (samples[neighbor]&0xffffff)==color) {
                            seen[neighbor]=true;pending.push(neighbor);
                        }
                    }
                }
                cache[key].push(new Rectangle(left,top,right-left+1,bottom-top+1));
            }
            bitmapBounds[bitmap]=cache;
            return cache;
        }
        private function describeEntities(rows:Array):void {
            if(!api.currentScene)return;
            readOnlyNodes=new Dictionary(true);
            var displays:Dictionary=new Dictionary(true);
            var collisions:Array=[];
            var areas:Array=[];
            var entity:Object;var component:Object;var kind:String;var display:Display;var spatial:Spatial;
            try {
                for each(entity in api.currentScene.systemManager.entities) {
                    if(!sceneEntity(entity))continue;
                    var category:String="";var id:String=entity.name;var hit:Object=null;var area:Object=null;var hitKind:String="";
                    display=entity.get(Display);spatial=entity.get(Spatial);
                    for each(component in entity.getAll()) {
                        kind=getQualifiedClassName(component).split("::").pop();
                        if(kind=="Id")id=component.id;
                        if(kind=="BitmapHit")hit=component;
                        if(kind=="BitmapHitArea")area=component;
                        var found:String=categoryFor(kind);
                        if(found && categoryPriority(found)>categoryPriority(category)) {
                            category=found;hitKind=kind;
                        }
                    }
                    if(area && spatial) {
                        if(!identities[entity])identities[entity]=nextIdentity++;
                        areas.push({bitmap:area.bitmapData,spatial:spatial,group:entity.group,key:String(identities[entity])});
                    }
                    if(display && display.displayObject && category) {
                        var d:DisplayObject=display.displayObject;
                        displays[d]={category:category,id:id,kind:hitKind};
                        if((!display.visible || !d.visible || d.alpha<=0) && category!="characters" && category!="items" && !originals[d] && d.stage) {
                            displays[d].readOnly=true;readOnlyNodes[d]=true;
                            displays[d].shown=true;
                            var owner:DisplayObject=d.parent;
                            while(owner){if(!owner.visible || owner.alpha<=0)displays[d].shown=false;owner=owner.parent;}
                        }
                    }
                    if(hit && category)collisions.push({entity:entity,id:id,category:category,kind:hitKind,color:hit.color});
                }
                var container:DisplayObject=api.currentScene.hitContainer as DisplayObject;
                if(container && container.stage)for each(var collision:Object in collisions)for each(var entry:Object in areas) {
                    var bitmap:BitmapData=entry.bitmap as BitmapData;
                    if(!bitmap || entry.group!==collision.entity.group)continue;
                    var cache:Object=cacheCollisionBounds(bitmap,collisions,entry.group);var colorKey:String=String(uint(collision.color)&0xffffff);
                    var regions:Array=cache[colorKey];
                    spatial=entry.spatial;
                    if(!regions || !spatial.scaleX || !spatial.scaleY)continue;
                    for(var region:int=0;region<regions.length;region++) {
                        var pixels:Rectangle=regions[region];
                        var local:Rectangle=new Rectangle((pixels.x-spatial.x)/spatial.scaleX,(pixels.y-spatial.y)/spatial.scaleY,pixels.width/spatial.scaleX,pixels.height/spatial.scaleY);
                        var label:String=collision.id+(regions.length>1?" "+(region+1):"");
                        collisionRow(rows,collision.entity,label,collision.category,collision.kind,worldBounds(container,local),"bitmap-"+entry.key+"-"+region);
                    }
                }
            } catch(error:Error) {}
            for each(var row:Object in rows) {
                var node:DisplayObject=nodes[row.path];
                if(!node)continue;
                var info:Object=displays[node];
                if(info){
                    row.category=info.category;row.entityName=info.id;row.readOnly=info.readOnly===true;
                    if(info.readOnly){row.shown=info.shown;row.kind=info.kind+" area";row.source="Collision bounds";}
                }
                var ancestor:DisplayObject=node;
                while(ancestor){if(readOnlyNodes[ancestor]){row.readOnly=true;break;}ancestor=ancestor.parent;}
                try {
                    if(node.hasOwnProperty("islandengineKind")) {
                        kind=String(Object(node)["islandengineKind"]);
                        row.category=categoryFor(kind);if(!row.category)row.category="scenery";
                        if(kind=="trigger" && node.parent && Object(node)["islandengineWidth"]>0 && Object(node)["islandengineHeight"]>0) {
                            var trigger:Rectangle=worldBounds(node.parent,new Rectangle(Number(Object(node)["islandengineAreaX"]),Number(Object(node)["islandengineAreaY"]),Number(Object(node)["islandengineWidth"]),Number(Object(node)["islandengineHeight"])));
                            row.left=trigger.x;row.top=trigger.y;row.width=trigger.width;row.height=trigger.height;
                            row.originX=trigger.x;row.originY=trigger.y;
                            row.readOnly=true;readOnlyNodes[node]=true;row.kind="Trigger area";row.source="Trigger area";
                            row.shown=node.visible;ancestor=node.parent;
                            while(ancestor){if(!ancestor.visible || ancestor.alpha<=0)row.shown=false;ancestor=ancestor.parent;}
                        }
                    }
                } catch(ignored:Error) {}
            }
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
            var ancestor:DisplayObject=d;
            while(ancestor){if(readOnlyNodes[ancestor])return {error:"This collision shape can only be inspected."};ancestor=ancestor.parent;}
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
            originals=new Dictionary(true);applied=new Dictionary(true);bitmapBounds=new Dictionary(true);readOnlyNodes=new Dictionary(true);appliedRoom=current;
        }
    }
}
