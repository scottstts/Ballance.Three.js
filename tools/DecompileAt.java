// Ghidra headless post-script: print the decompilation of a function address.
// Usage: analyzeHeadless <project-dir> <project> -import <binary>
//        -postScript DecompileAt.java 0x10004a80 -deleteProject
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

public final class DecompileAt extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) {
            throw new IllegalArgumentException("expected one function address");
        }

        Address address = currentProgram.getAddressFactory().getAddress(args[0]);
        Function function = getFunctionAt(address);
        if (function == null) {
            disassemble(address);
            function = createFunction(address, null);
        }
        if (function == null) {
            throw new IllegalStateException("could not define function at " + address);
        }

        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        DecompileResults results = decompiler.decompileFunction(function, 120, monitor);
        if (!results.decompileCompleted()) {
            throw new IllegalStateException(results.getErrorMessage());
        }
        println(results.getDecompiledFunction().getC());
        decompiler.dispose();
    }
}
