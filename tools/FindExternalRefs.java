// Ghidra headless post-script: print matching external imports and references to their thunks/IAT slots.
// Usage: analyzeHeadless ... -postScript FindExternalRefs.java Squad
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.ExternalLocation;
import ghidra.program.model.symbol.ExternalLocationIterator;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

public final class FindExternalRefs extends GhidraScript {
    @Override
    protected void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("expected one import-name fragment");
        String needle = args[0].toLowerCase();
        for (String library : currentProgram.getExternalManager().getExternalLibraryNames()) {
            ExternalLocationIterator locations = currentProgram.getExternalManager().getExternalLocations(library);
            while (locations.hasNext() && !monitor.isCancelled()) {
                ExternalLocation location = locations.next();
                String label = location.getLabel();
                String original = location.getOriginalImportedName();
                String searchable = (library + " " + label + " " + original).toLowerCase();
                if (!searchable.contains(needle)) continue;
                println("external " + library + "!" + label + " original=" + original + " @ " + location.getAddress());
                ReferenceIterator references = currentProgram.getReferenceManager().getReferencesTo(location.getAddress());
                while (references.hasNext()) {
                    Reference reference = references.next();
                    Function function = getFunctionContaining(reference.getFromAddress());
                    println("  " + reference.getFromAddress() + " in " + (function == null ? "<none>" : function.getName()));
                }
            }
        }
    }
}
