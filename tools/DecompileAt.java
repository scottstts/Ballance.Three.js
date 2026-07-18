// Ghidra headless post-script: print the decompilation of a function address.
// Usage: analyzeHeadless <project-dir> <project> -import <binary>
//        -postScript DecompileAt.java 0x10004a80 [0x10004b20 ...] -deleteProject
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

public final class DecompileAt extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length == 0) {
            throw new IllegalArgumentException("expected at least one function address");
        }

        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        for (String arg : args) {
            Address address = currentProgram.getAddressFactory().getAddress(arg);
            Function function = getFunctionAt(address);
            if (function == null) {
                disassemble(address);
                function = createFunction(address, null);
            }
            if (function == null) {
                throw new IllegalStateException("could not define function at " + address);
            }
            DecompileResults results = decompiler.decompileFunction(function, 120, monitor);
            if (!results.decompileCompleted()) {
                throw new IllegalStateException(results.getErrorMessage());
            }
            println("==== " + arg + " ====");
            println(results.getDecompiledFunction().getC());
        }
        decompiler.dispose();
    }
}
