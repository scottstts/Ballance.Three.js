// Ghidra headless post-script: print every instruction in one or more functions.
// Usage: analyzeHeadless ... -postScript DumpFunction.java 0x1000c810 [...]
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;

public final class DumpFunction extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length == 0) {
            throw new IllegalArgumentException("expected at least one function address");
        }

        for (String arg : args) {
            Address address = currentProgram.getAddressFactory().getAddress(arg);
            Function function = getFunctionContaining(address);
            if (function == null) {
                disassemble(address);
                function = createFunction(address, null);
            }
            if (function == null) {
                throw new IllegalStateException("could not define function at " + address);
            }

            println("==== " + function.getName() + " " + function.getBody() + " ====");
            InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
            while (instructions.hasNext() && !monitor.isCancelled()) {
                Instruction instruction = instructions.next();
                println(instruction.getAddress() + "  " + instruction);
            }
        }
    }
}
