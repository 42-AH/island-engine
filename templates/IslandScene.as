package islandengine
{
    import ash.core.Entity;
    import engine.components.Id;
    import engine.components.Display;
    import engine.components.Spatial;
    import engine.components.Motion;
    import engine.creators.InteractionCreator;
    import flash.display.DisplayObject;
    import flash.display.DisplayObjectContainer;
    import flash.display.MovieClip;
    import flash.events.Event;
    import flash.events.MouseEvent;
    import flash.external.ExternalInterface;
    import flash.geom.Point;
    import flash.geom.Rectangle;
    import game.components.hit.Platform;
    import game.components.motion.Edge;
    import flash.net.SharedObject;
    import flash.text.TextField;
    import flash.text.TextFormat;
    import flash.utils.getTimer;
    import game.components.entity.Dialog;
    import game.components.scene.SceneInteraction;
    import game.creators.scene.HitCreator;
    import game.creators.ui.ToolTipCreator;
    import game.scene.template.PlatformerGameScene;
    import game.scene.template.SceneUIGroup;
    import game.util.ClassUtils;
    import game.util.EntityUtils;
    import game.util.SceneUtil;
    import game.util.AudioUtils;
    import game.data.TimedEvent;
    public class IslandScene extends PlatformerGameScene
    {
        protected var islandId:String;
        protected var spec:XML;
        protected var art:MovieClip;
        protected var state:SharedObject;
        protected var objects:Object = {};
        protected var sprites:Object = {};
        protected var movers:Array = [];
        protected var busy:Boolean = false;
        protected var queue:Array = [];
        protected var clock:Number = 0;
        protected var elapsed:Number = 0;
        protected var respawnAt:Point;
        protected var panel:MovieClip;
        protected var enteredZones:Object = {};
        public function IslandScene(id:String, room:XML)
        {
            super();
            islandId=id;
            spec=room;
            state=SharedObject.getLocal("islandengine_"+id,"/");
            if(!state.data.flags)state.data.flags= {};
            if(!state.data.items)state.data.items= {};
            if(!state.data.checkpoints)state.data.checkpoints= {};
        }
        override public function init(container:DisplayObjectContainer=null):void
        {
            groupPrefix="scenes/"+islandId+"/"+String(spec.@id)+"/";
            super.init(container);
        }
        override protected function addGroups():void
        {
            art=getAsset("interactive.swf") as MovieClip;
            art.graphics.beginFill(color(String(spec.@background),0xABD3DA));
            art.graphics.drawRect(0,0,Number(spec.@width),Number(spec.@height));
            art.graphics.endFill();
            var hits:MovieClip=new MovieClip();
            hits.name="bitmapHits";
            art["bitmapHits"]=hits;
            for each(var o:XML in spec.object)
            {
                var id:String=String(o.@id);
                objects[id]=o;
                var kind:String=String(o.@kind);
                var x:Number=Number(o.@x);
                var y:Number=Number(o.@y);
                var w:Number=Number(o.@width);
                var h:Number=Number(o.@height);
                if(kind=="platform" || kind=="wall" || kind=="water" || kind=="climb")
                {
                    hits.graphics.beginFill(kind=="platform"?0x00FF00:(kind=="wall"?0xFF6600:(kind=="climb"?0xFFFF00:0x0000FF)));
                    hits.graphics.drawRect(x,y,w,h);
                    hits.graphics.endFill();
                }
                if(kind=="npc")continue;
                var shape:MovieClip=new MovieClip();
                shape.name=id;
                shape.islandengineKind=kind;
                shape.islandengineAreaX=x;
                shape.islandengineAreaY=y;
                shape.islandengineWidth=w;
                shape.islandengineHeight=h;
                shape.x=x;
                shape.y=y;
                shape.mouseEnabled=false;
                shape.mouseChildren=false;
                if(String(o.@asset)!="")
                {
                    var asset:DisplayObject=getAsset(String(o.@asset),true) as DisplayObject;
                    if(asset)
                    {
                        var bounds:Rectangle=asset.getBounds(asset);
                        if(bounds.width>0)asset.scaleX=w/bounds.width;
                        if(bounds.height>0)asset.scaleY=h/bounds.height;
                        asset.x=-bounds.x*asset.scaleX;
                        asset.y=-bounds.y*asset.scaleY;
                        shape.addChild(asset);
                    }
                }
                else if(kind!="trigger")
                {
                    shape.graphics.beginFill(color(String(o.@color),kind=="item"?0xE8B85B:0x586C70),String(o.@hidden)=="true"?0:(kind=="water"?0.55:1));
                    shape.graphics.drawRoundRect(0,0,w,h,kind=="item"?12:2);
                    shape.graphics.endFill();
                    if(kind=="climb")
                    {
                        shape.graphics.lineStyle(3,0xD7C49E);
                        for(var rung:Number=8;rung<h;rung+=18)
                        {
                            shape.graphics.moveTo(0,rung);
                            shape.graphics.lineTo(w,rung);
                        }
                    }
                    if((kind=="door" || kind=="item" || kind=="switch") && String(o.@hidden)!="true")label(shape,String(o.@label)!=""?String(o.@label):id,4,8,w-8,0xFFFFFF,13);
                }
                if(String(o.@rotation)!="")shape.rotation=Number(o.@rotation);
                if(String(o.@hidden)=="true")shape.alpha=0;
                art.addChild(shape);
                sprites[id]=shape;
                if(kind=="movingPlatform")movers.push(
                {
                    node:o,view:shape,entity:null,lastX:x,lastY:y
                }
                );
            }
            art.addChild(hits);
            super.addGroups();
        }
        override public function loaded():void
        {
            super.loaded();
            var pos:Spatial=player.get(Spatial);
            respawnAt=new Point(pos.x,pos.y);
            var checkpoint:Object=state.data.checkpoints[String(spec.@id)];
            if(checkpoint)respawnAt=new Point(checkpoint.x,checkpoint.y);
            for each(var o:XML in spec.object)
            {
                var id:String=String(o.@id);
                var kind:String=String(o.@kind);
                if(kind=="npc")hookNpc(id);
                if(kind=="item" || kind=="door" || kind=="switch")hook(id);
            }
            for each(var mover:Object in movers)
            {
                var m:MovieClip=new MovieClip();
                m.x=mover.view.x;
                m.y=mover.view.y;
                m.graphics.beginFill(0x00FF00);
                m.graphics.drawRect(0,0,Number(mover.node.@width),Number(mover.node.@height));
                m.graphics.endFill();
                art.addChild(m);
                m.name=String(mover.node.@id)+"_hit";
                mover.entity=new HitCreator().createHit(m,"platform",null,this,false,false);
                var surfaceMotion:Motion=new Motion();
                surfaceMotion.x=m.x;
                surfaceMotion.y=m.y;
                mover.entity.add(surfaceMotion);
                var platform:Platform=mover.entity.get(Platform);
                platform.hitRect=new Rectangle(0,0,Number(mover.node.@width),Number(mover.node.@height));
                platform.top=true;
            }
            shellApi.eventTriggered.add(onInventoryEvent);
            shellApi.profileManager.inventoryType="island";
            clock=getTimer();
            art.addEventListener(Event.ENTER_FRAME,tick);
            state.data.room=String(spec.@id);
            state.flush();
            refresh();
            onReady();
            if(ExternalInterface.available)ExternalInterface.call("islandengineReady",String(spec.@id),pos.x,pos.y);
        }
        protected function hook(id:String):void
        {
            var shape:MovieClip=sprites[id];
            shape.mouseEnabled=true;
            shape.buttonMode=true;
            var entity:Entity=EntityUtils.createSpatialEntity(this,shape,_hitContainer);
            entity.add(new Id(id));
            var interaction:SceneInteraction=new SceneInteraction();
            interaction.minTargetDelta=new Point(100,130);
            entity.add(interaction);
            InteractionCreator.addToEntity(entity,["click"]);
            ToolTipCreator.addToEntity(entity,"click");
            if(String(objects[id].@kind)=="item")
            {
                interaction.approach=false;
                interaction.triggered.add(function(...rest):void
                {
                    var pos:Spatial=player.get(Spatial);
                    if(Math.abs(pos.x-shape.x)<170 && Math.abs(pos.y-shape.y)<160)activate(id);
                    else if(!busy)say("I need to get closer.","player");
                }
                );
            }
            else interaction.reached.add(function(...rest):void
            {
                activate(id);
            }
            );
        }
        protected function hookNpc(id:String):void
        {
            var entity:Entity=getEntityById(id);
            if(!entity)return;
            var interaction:SceneInteraction=entity.get(SceneInteraction);
            if(!interaction)return;
            interaction.reached.removeAll();
            interaction.reached.add(function(...rest):void
            {
                activate(id);
            }
            );
        }
        public function flag(id:String):Boolean
        {
            return state.data.flags[id]===true;
        }
        public function hasItem(id:String):Boolean
        {
            return state.data.items[id]!=null;
        }
        public function giveItem(id:String,name:String=""):void
        {
            state.data.items[id]=name!=""?name:id;
            state.flush();refresh();
        }
        public function takeItem(id:String):void
        {
            delete state.data.items[id];
            state.flush();refresh();
        }
        public function useItem(id:String):void
        {
            onInventoryEvent("islandengine_use_"+id);
        }
        public function mark(id:String,value:Boolean=true):void
        {
            state.data.flags[id]=value;
            state.flush();
            refresh();
        }
        protected function allowed(o:XML):Boolean
        {
            if(String(o.@requires)!="" && !flag(String(o.@requires)))return false;
            if(String(o.@requiresItem)!="" && !hasItem(String(o.@requiresItem)))return false;
            if(String(o.@unless)!="" && flag(String(o.@unless)))return false;
            return true;
        }
        protected function available(o:XML):Boolean
        {
            if(String(o.@showWhen)!=""&&!flag(String(o.@showWhen)))return false;
            if(String(o.@hideWhen)!=""&&flag(String(o.@hideWhen)))return false;
            if(String(o.@kind)=="item" && flag(objectFlag("taken",String(o.@id))))return false;
            return true;
        }
        public function activate(id:String):void
        {
            if(busy)return;
            var o:XML=objects[id];
            if(!o || !available(o))return;
            if(!allowed(o))
            {
                say(String(o.@lockedText)!=""?String(o.@lockedText):"Something is missing.","player");
                return;
            }
            if(String(o.@kind)=="item")
            {
                var itemId:String=String(o.@itemId)!=""?String(o.@itemId):id;
                state.data.items[itemId]=String(o.@label)!=""?String(o.@label):itemId;
                state.data.flags[objectFlag("taken",id)]=true;
                state.flush();
                refresh();
            }
            queue=[];
            if(String(o.@text)!="")queue.push(new XML('<action type="say"/>'));
            if(queue.length)
            {
                queue[0].@text=String(o.@text);
                queue[0].@speaker=String(o.@kind)=="npc"?id:"player";
            }
            for each(var action:XML in o.action)queue.push(action.copy());
            if(String(o.@kind)=="door")
            {
                var travel:XML=<action type="travel"/>;
                travel.@room=String(o.@target);
                travel.@x=String(o.@targetX);
                travel.@y=String(o.@targetY);
                queue.push(travel);
            }
            next();
        }
        protected function next(...rest):void
        {
            busy=false;
            SceneUtil.lockInput(this,false);
            while(queue.length)
            {
                var action:XML=queue.shift();
                if(!allowed(action))continue;
                var type:String=String(action.@type);
                var id:String=String(action.@id);
                if(type=="say")
                {
                    say(String(action.@text),String(action.@speaker));
                    return;
                }
                if(type=="flag")state.data.flags[id]=String(action.@value)!="false";
                if(type=="give")state.data.items[id]=String(action.@label)!=""?String(action.@label):id;
                if(type=="take")delete state.data.items[id];
                if(type=="sound")AudioUtils.play(this,String(action.@asset));
                if(type=="wait")
                {
                    state.flush();refresh();
                    busy=true;
                    SceneUtil.lockInput(this,true);
                    SceneUtil.addTimedEvent(this,new TimedEvent(Number(action.@seconds),1,next));
                    return;
                }
                if(type=="camera")
                {
                    var target:Entity=id=="player"?player:getEntityById(id);
                    if(target)SceneUtil.setCameraTarget(this,target);
                }
                if(type=="move")
                {
                    var actor:Entity=id=="player"?player:getEntityById(id);
                    if(actor)
                    {
                        var place:Spatial=actor.get(Spatial);
                        place.x=Number(action.@x);place.y=Number(action.@y);
                        var movement:Motion=actor.get(Motion);
                        if(movement){movement.x=place.x;movement.y=place.y;movement.velocity.x=0;movement.velocity.y=0;}
                    }
                }
                if(type=="checkpoint")
                {
                    var pos:Spatial=player.get(Spatial);
                    respawnAt=new Point(pos.x,pos.y);
                    state.data.checkpoints[String(spec.@id)]={x:pos.x,y:pos.y};
                }
                if(type=="custom")
                {
                    state.flush();refresh();
                    if(onAction(action)){busy=true;SceneUtil.lockInput(this,true);return;}
                }
                if(type=="complete")
                {
                    mark("island_complete");
                    state.flush();refresh();
                    showPanel("Island complete",String(action.@text)!=""?String(action.@text):"Thanks for playing.");
                    queue=[];
                    return;
                }
                if(type=="travel")
                {
                    var room:String=String(action.@room);
                    var name:String=room.charAt(0).toUpperCase()+room.substr(1);
                    state.flush();refresh();
                    shellApi.loadScene(ClassUtils.getClassByName("game.scenes."+islandId+"."+room+"."+name),String(action.@x)!=""?Number(action.@x):160,String(action.@y)!=""?Number(action.@y):650);
                    return;
                }
            }
            state.flush();refresh();
        }
        protected function say(text:String,who:String):void
        {
            busy=true;
            SceneUtil.lockInput(this,true);
            var speaker:Entity=who!=""&&who!="player"?getEntityById(who):player;
            if(!speaker)speaker=player;
            var dialog:Dialog=speaker.get(Dialog);
            if(!dialog)
            {
                dialog=new Dialog();
                speaker.add(dialog);
            }
            dialog.complete.addOnce(next);
            dialog.say(text);
        }
        protected function refresh():void
        {
            syncInventory();
            for each(var o:XML in spec.object)
            {
                var shape:MovieClip=sprites[String(o.@id)];
                var visible:Boolean=!(String(o.@kind)=="item"&&flag(objectFlag("taken",String(o.@id))));
                if(String(o.@showWhen)!="")visible=visible&&flag(String(o.@showWhen));
                if(String(o.@hideWhen)!="")visible=visible&&!flag(String(o.@hideWhen));
                if(shape)shape.visible=visible;
                var entity:Entity=getEntityById(String(o.@id));
                if(entity)
                {
                    var display:Display=entity.get(Display);
                    if(display){display.visible=visible;display.alpha=String(o.@hidden)=="true"?0:1;}
                }
            }
        }
        protected function tick(event:Event):void
        {
            var now:Number=getTimer();
            var dt:Number=Math.min(.05,(now-clock)/1000);
            clock=now;
            elapsed+=dt;
            var pos:Spatial=player.get(Spatial);
            var motion:Motion=player.get(Motion);
            if(!pos)return;
            var edge:Edge=player.get(Edge);
            var carried:Boolean=false;
            for each(var mover:Object in movers)
            {
                var o:XML=mover.node;
                var dx:Number=String(o.@travelX)!=""?Number(o.@travelX):200;
                var dy:Number=String(o.@travelY)!=""?Number(o.@travelY):0;
                var phase:Number=(1-Math.cos(elapsed*(String(o.@speed)!=""?Number(o.@speed):1)))/2;
                var nx:Number=Number(o.@x)+dx*phase;
                var ny:Number=Number(o.@y)+dy*phase;
                var feet:Number=motion.y+(edge?edge.rectangle.bottom:0);
                if(!carried && motion.velocity.y>=0 && Math.abs(feet-mover.lastY)<=4 && motion.x>=mover.lastX && motion.x<=mover.lastX+Number(o.@width))
                {
                    motion.x+=nx-mover.lastX;
                    motion.y+=ny-mover.lastY;
                    pos.x=motion.x;
                    pos.y=motion.y;
                    carried=true;
                }
                mover.view.x=nx;
                mover.view.y=ny;
                if(mover.entity)
                {
                    var surface:Spatial=mover.entity.get(Spatial);
                    surface.x=nx;
                    surface.y=ny;
                    var surfaceMotion:Motion=mover.entity.get(Motion);
                    surfaceMotion.x=nx;
                    surfaceMotion.y=ny;
                }
                mover.lastX=nx;
                mover.lastY=ny;
            }
            onTick(dt);
            if(busy)return;
            for each(var zone:XML in spec.object)
            {
                var kind:String=String(zone.@kind);
                if(kind!="hazard"&&kind!="bounce"&&kind!="trigger")continue;
                var zoneId:String=String(zone.@id);
                var inside:Boolean=pos.x>=Number(zone.@x)&&pos.x<=Number(zone.@x)+Number(zone.@width)&&pos.y>=Number(zone.@y)&&pos.y<=Number(zone.@y)+Number(zone.@height);
                if(!inside){enteredZones[zoneId]=false;continue;}
                if(kind=="hazard")
                {
                    respawn();
                    return;
                }
                if(kind=="bounce"&&motion)motion.velocity.y=-(String(zone.@strength)!=""?Number(zone.@strength):750);
                if(kind=="trigger"&&!enteredZones[zoneId]&&(String(zone.@repeat)=="true"||!flag(objectFlag("trigger",zoneId)))&&available(zone)&&allowed(zone))
                {
                    enteredZones[zoneId]=true;
                    mark(objectFlag("trigger",zoneId));
                    activate(zoneId);
                    if(busy)return;
                }
            }
            if(pos.y>Number(spec.@height)+100)
            {
                respawn();
            }
        }
        protected function objectFlag(kind:String,id:String):String
        {
            return kind+":"+String(spec.@id)+":"+id;
        }
        protected function respawn():void
        {
            var pos:Spatial=player.get(Spatial);
            var motion:Motion=player.get(Motion);
            pos.x=respawnAt.x;pos.y=respawnAt.y;
            motion.x=pos.x;motion.y=pos.y;
            motion.velocity.x=0;motion.velocity.y=0;
        }
        protected function onReady():void {}
        protected function onTick(seconds:Number):void {}
        protected function onAction(action:XML):Boolean { return false; }
        protected function openInventory(event:MouseEvent):void
        {
            syncInventory();
            var ui:SceneUIGroup=getGroupById(SceneUIGroup.GROUP_ID) as SceneUIGroup;
            if(ui && ui.hud)ui.hud.openInventory(false);
        }
        protected function syncInventory():void
        {
            var saved:Array=[];
            for each(var card:String in shellApi.itemManager.getMakeSet(islandId).cardIds)saved.push(card);
            for each(var old:String in saved)if(!state.data.items.hasOwnProperty(old))shellApi.itemManager.remove(old,islandId);
            for(var id:String in state.data.items)shellApi.itemManager.add(id,islandId);
        }
        protected function onUseItem(id:String):Boolean { return false; }
        protected function onInventoryEvent(event:String,save:Boolean=true,remove:Boolean=false,type:String=null):void
        {
            if(event.indexOf("islandengine_use_")!=0)return;
            var id:String=event.substr(17);
            if(busy || !hasItem(id) || onUseItem(id))return;
            var pos:Spatial=player.get(Spatial);
            for each(var o:XML in spec.object) {
                if(String(o.@requiresItem)==id && available(o) && Math.abs(pos.x-Number(o.@x))<180 && Math.abs(pos.y-Number(o.@y))<180) {
                    activate(String(o.@id));return;
                }
            }
            for each(var item:XML in spec.inventory.item) {
                if(String(item.@id)==id && item.action.length()>0) {
                    if(!allowed(item)) { say(String(item.@lockedText)!=""?String(item.@lockedText):"Something is missing.","player");return; }
                    queue=[];
                    for each(var action:XML in item.action)queue.push(action.copy());
                    next();return;
                }
            }
            say("I can't use that here.","player");
        }

        protected function showPanel(title:String,text:String):void
        {
            if(panel)closePanel(null);
            panel=new MovieClip();
            panel.graphics.beginFill(0xF1E6CB);
            panel.graphics.drawRoundRect(0,0,430,280,14);
            panel.graphics.endFill();
            panel.x=(shellApi.viewportWidth-430)/2;
            panel.y=(shellApi.viewportHeight-280)/2;
            label(panel,title,24,20,382,0x243B43,26);
            var body:TextField=new TextField();
            body.defaultTextFormat=new TextFormat("Arial",18,0x243B43);
            body.text=text;body.x=24;body.y=68;body.width=382;body.height=150;
            body.multiline=true;body.wordWrap=true;body.selectable=false;body.mouseWheelEnabled=true;
            panel.addChild(body);
            label(panel,body.textHeight>150?"Scroll to read more. Click to close.":"Click to close",24,237,382,0x54666A,14);
            panel.addEventListener(MouseEvent.CLICK,closePanel);
            overlayContainer.addChild(panel);
        }
        protected function closePanel(event:MouseEvent):void
        {
            if(panel&&panel.parent)panel.parent.removeChild(panel);
            panel=null;
        }
        protected function label(target:MovieClip,text:String,x:Number,y:Number,width:Number,ink:uint,size:Number):void
        {
            var field:TextField=new TextField();
            field.defaultTextFormat=new TextFormat("Arial",size,ink);
            field.text=text;
            field.x=x;
            field.y=y;
            field.width=width;
            field.height=160;
            field.wordWrap=true;
            field.selectable=false;
            field.mouseEnabled=false;
            target.addChild(field);
        }
        protected function color(value:String,fallback:uint):uint
        {
            return value!=""?uint("0x"+value.replace("#","")):fallback;
        }
        override public function destroy():void
        {
            if(art)art.removeEventListener(Event.ENTER_FRAME,tick);
            shellApi.eventTriggered.remove(onInventoryEvent);
            state.flush();
            super.destroy();
        }
    }
}
