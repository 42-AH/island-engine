import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;
import com.jpexs.decompiler.flash.SWF;
import com.jpexs.decompiler.flash.abc.ABC;
import com.jpexs.decompiler.flash.abc.avm2.parser.script.AbcIndexing;
import com.jpexs.decompiler.flash.abc.avm2.parser.script.ActionScript3Parser;
import com.jpexs.decompiler.flash.tags.*;

/** Adds classes in dependency order, before the first frame. */
public final class AppendAs3Classes {
  private static final Pattern PACKAGE = Pattern.compile("\\bpackage\\s+([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)");
  private static final Pattern CLASS = Pattern.compile("\\bpublic\\s+(?:final\\s+)?class\\s+([A-Za-z_$][\\w$]*)");

  public static void main(String[] args) throws Exception {
    if (args.length < 3) throw new IllegalArgumentException("input.swf output.swf source1.as [source2.as ...]");
    SWF swf;
    try (InputStream in = new BufferedInputStream(new FileInputStream(args[0]))) { swf = new SWF(in, true); }
    List<String> names = new ArrayList<>(), sources = new ArrayList<>();
    for (int i = 2; i < args.length; i++) {
      String source = new String(Files.readAllBytes(Paths.get(args[i])), StandardCharsets.UTF_8);
      Matcher p = PACKAGE.matcher(source), c = CLASS.matcher(source);
      if (!p.find() || !c.find()) throw new IllegalArgumentException("Cannot determine public class: " + args[i]);
      String name = p.group(1) + "." + c.group(1);
      if (names.contains(name)) throw new IllegalArgumentException("Duplicate requested class: " + name);
      for (ABCContainerTag old : swf.getAbcList()) if (old.getABC().findClassByName(name) >= 0) throw new IllegalStateException("Class already exists: " + name);
      names.add(name); sources.add(source);
    }
    DoABC2Tag tag = new DoABC2Tag(swf);
    tag.name = "dead-air-native-classes";
    ABC abc = new ABC(tag); tag.setABC(abc);
    int firstFrame = swf.getTags().size();
    for (int i = 0; i < swf.getTags().size(); i++) if (swf.getTags().get(i) instanceof ShowFrameTag) { firstFrame = i; break; }
    swf.addTag(firstFrame, tag);
    swf.clearAbcListCache();
    AbcIndexing index = swf.getAbcIndex(); index.addAbc(abc); index.selectAbc(abc);
    for (int i = 0; i < sources.size(); i++) {
      int scriptIndex = abc.script_info.size();
      ActionScript3Parser.compile(sources.get(i), abc, index, args[i + 2], scriptIndex, 0, false, "");
      index.refreshAbc(abc); index.selectAbc(abc);
      if (abc.findClassByName(names.get(i)) < 0) throw new IllegalStateException("Compiled class missing: " + names.get(i));
    }
    tag.setModified(true); swf.setModified(true);
    try (OutputStream out = new BufferedOutputStream(new FileOutputStream(args[1]))) { swf.saveTo(out); }
    SWF check;
    try (InputStream in = new BufferedInputStream(new FileInputStream(args[1]))) { check = new SWF(in, true); }
    int tagIndex = -1, showIndex = check.getTags().size();
    for (int i = 0; i < check.getTags().size(); i++) {
      Tag t = check.getTags().get(i);
      if (t instanceof ShowFrameTag && showIndex == check.getTags().size()) showIndex = i;
      if (t instanceof DoABC2Tag && "dead-air-native-classes".equals(((DoABC2Tag)t).name)) tagIndex = i;
    }
    if (tagIndex < 0 || tagIndex >= showIndex) throw new IllegalStateException("New ABC is not before first ShowFrame");
    for (String name : names) {
      int count = 0; for (ABCContainerTag item : check.getAbcList()) if (item.getABC().findClassByName(name) >= 0) count++;
      if (count != 1) throw new IllegalStateException("Expected exactly one saved class " + name + ", found " + count);
      System.out.println("verified " + name);
    }
    System.out.println("verified DoABC index " + tagIndex + " before ShowFrame index " + showIndex);
  }
}
