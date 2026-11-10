package custom
{
    import islandengine.IslandScene;

    public class RoomRules extends IslandScene
    {
        public function RoomRules(island:String, room:XML)
        {
            super(island, room);
        }

        override protected function onReady():void
        {
            if (sprites.windmill) sprites.windmill.rotation = 0;
        }

        override protected function onTick(seconds:Number):void
        {
            if (sprites.windmill) sprites.windmill.rotation += seconds * 30;
        }

        override protected function onAction(action:XML):Boolean
        {
            if (String(action.@id) == "turnLamp") mark("lamp_on", !flag("lamp_on"));
            return false;
        }
    }
}
