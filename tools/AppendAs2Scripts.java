import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import com.jpexs.decompiler.flash.SWF;
import com.jpexs.decompiler.flash.tags.*;
import com.jpexs.decompiler.flash.action.parser.script.ActionScript2Parser;

/** Adds small frame scripts without decompiling or rewriting the original scripts. */
public final class AppendAs2Scripts {
  public static void main(String[] args) throws Exception {
    if (args.length < 4 || args.length % 2 != 0) throw new IllegalArgumentException("input.swf output.swf frame script.as [frame script.as]");
    SWF swf;
    try (InputStream in = new BufferedInputStream(new FileInputStream(args[0]))) { swf = new SWF(in, true); }
    for (int a = 2; a < args.length; a += 2) {
      int wanted = Integer.parseInt(args[a]), frame = 1, index = -1;
      for (int i = 0; i < swf.getTags().size(); i++) {
        if (swf.getTags().get(i) instanceof ShowFrameTag) {
          if (frame == wanted) { index = i; break; }
          frame++;
        }
      }
      if (index < 0) throw new IllegalArgumentException("Missing frame " + wanted);
      String code = new String(Files.readAllBytes(Paths.get(args[a + 1])), StandardCharsets.UTF_8);
      DoActionTag tag = new DoActionTag(swf);
      tag.setActions(new ActionScript2Parser(swf, tag).actionsFromString(code, swf.getCharset()));
      tag.setModified();
      swf.addTag(index, tag);
    }
    swf.setModified(true);
    try (OutputStream out = new BufferedOutputStream(new FileOutputStream(args[1]))) { swf.saveTo(out); }
    System.out.println("Added " + ((args.length - 2) / 2) + " frame scripts");
  }
}
