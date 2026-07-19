// Ghidra headless post-script: find strings containing a term and their references.
// Usage: analyzeHeadless ... -postScript FindStringRefs.java "TT SkyAround"
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

public final class FindStringRefs extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length == 0) throw new IllegalArgumentException("expected a string fragment");
        String needle = args[0].toLowerCase();
        DataIterator data = currentProgram.getListing().getDefinedData(true);
        while (data.hasNext() && !monitor.isCancelled()) {
            Data value = data.next();
            Object raw = value.getValue();
            if (!(raw instanceof String string) || !string.toLowerCase().contains(needle)) continue;
            println("STRING " + value.getAddress() + " " + string);
            ReferenceIterator references = currentProgram.getReferenceManager().getReferencesTo(value.getAddress());
            while (references.hasNext()) {
                Reference reference = references.next();
                Function function = getFunctionContaining(reference.getFromAddress());
                println("  REF " + reference.getFromAddress() + " " + (function == null ? "<no function>" : function.getName()));
            }
        }
    }
}
