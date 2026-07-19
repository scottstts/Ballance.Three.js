// Ghidra headless post-script: list functions whose entry lies in an address range.
// Usage: analyzeHeadless ... -postScript ListFunctionsRange.java 0x2403b000 0x2403d000
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;

public final class ListFunctionsRange extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 2) throw new IllegalArgumentException("expected start and end addresses");
        Address start = currentProgram.getAddressFactory().getAddress(args[0]);
        Address end = currentProgram.getAddressFactory().getAddress(args[1]);
        FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(start, true);
        while (functions.hasNext() && !monitor.isCancelled()) {
            Function function = functions.next();
            if (function.getEntryPoint().compareTo(end) > 0) break;
            println(function.getEntryPoint() + " " + function.getName() + " " + function.getBody());
        }
    }
}
