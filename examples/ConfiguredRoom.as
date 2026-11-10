package custom
{
    public class ConfiguredRoom extends RoomRules
    {
        public function ConfiguredRoom(island:String, room:XML)
        {
            super(island, room);
        }

        override protected function onReady():void
        {
            super.onReady();
            if (spec.data.length() == 0) return;
            var settings:Object = JSON.parse(String(spec.data));
            if (settings.startFlag) mark(String(settings.startFlag));
        }
    }
}
