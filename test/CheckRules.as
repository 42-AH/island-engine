package custom
{
    import islandengine.IslandScene;
    import game.data.TimedEvent;
    import game.util.SceneUtil;

    public class CheckRules extends IslandScene
    {
        public function CheckRules(island:String, room:XML) { super(island, room); }
        override protected function onReady():void { mark("script_ready"); }
        override protected function onTick(seconds:Number):void { state.data.flags.script_tick = true; }
        override protected function onAction(action:XML):Boolean
        {
            if (String(action.@id) == "test_custom") mark("custom_called");
            if (String(action.@id) == "custom_wait")
            {
                SceneUtil.addTimedEvent(this, new TimedEvent(.1, 1, next));
                return true;
            }
            return false;
        }
    }
}
