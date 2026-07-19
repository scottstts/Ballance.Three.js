// Ghidra headless post-script: print a little-endian pointer table and containing functions.
// Usage: analyzeHeadless ... -postScript DumpPointers.java 0x240403f0 32
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

public final class DumpPointers extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 2) throw new IllegalArgumentException("expected address and pointer count");
        Address address = currentProgram.getAddressFactory().getAddress(args[0]);
        int count = Integer.parseInt(args[1]);
        for (int index = 0; index < count; index++) {
            Address slot = address.add(index * 4L);
            long raw = Integer.toUnsignedLong(getInt(slot));
            Address target = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(raw);
            Function function = getFunctionAt(target);
            println(index + " " + slot + " -> " + target + " " + (function == null ? "<none>" : function.getName()));
        }
    }
}
