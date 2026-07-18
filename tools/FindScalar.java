// Ghidra headless post-script: print instructions containing selected scalars.
// Usage: analyzeHeadless <project-dir> <project> -process <binary>
//        -postScript FindScalar.java 0xf0 0x50
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.scalar.Scalar;

import java.util.HashSet;
import java.util.Set;

public final class FindScalar extends GhidraScript {
    @Override
    protected void run() throws Exception {
        Set<Long> wanted = new HashSet<>();
        for (String argument : getScriptArgs()) {
            wanted.add(Long.decode(argument));
        }
        if (wanted.isEmpty()) {
            throw new IllegalArgumentException("expected at least one scalar");
        }

        InstructionIterator instructions = currentProgram.getListing().getInstructions(true);
        while (instructions.hasNext() && !monitor.isCancelled()) {
            Instruction instruction = instructions.next();
            boolean matches = false;
            for (int operand = 0; operand < instruction.getNumOperands() && !matches; operand++) {
                for (Object object : instruction.getOpObjects(operand)) {
                    if (object instanceof Scalar scalar && wanted.contains(scalar.getUnsignedValue())) {
                        matches = true;
                        break;
                    }
                }
            }
            if (!matches) continue;
            Function function = getFunctionContaining(instruction.getAddress());
            String name = function == null ? "<no function>" : function.getName();
            println(instruction.getAddress() + " " + name + " " + instruction);
        }
    }
}
